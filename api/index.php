<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
start_app_session();

try {
    $db = database();
    $action = (string) ($_GET['action'] ?? '');

    switch ($action) {
        case 'products':
            require_method('GET');
            $rows = $db->query(
                'SELECT p.id, p.name, p.category, p.price, p.badge, p.description,
                        p.image_url AS image, i.quantity AS stock,
                        i.minimum_quantity AS minimumStock,
                        IF(i.quantity > 0, "Disponible", "Agotado") AS status
                 FROM products p JOIN inventory i ON i.product_id = p.id
                 WHERE p.is_active = 1
                 ORDER BY p.id'
            )->fetchAll();
            foreach ($rows as &$row) {
                $row['id'] = (int) $row['id'];
                $row['price'] = (float) $row['price'];
                $row['stock'] = (int) $row['stock'];
                $row['minimumStock'] = (int) $row['minimumStock'];
            }
            unset($row);
            respond(['products' => $rows]);

        case 'me':
            require_method('GET');
            $user = current_user();
            respond(['user' => $user === null ? null : public_user($user)]);

        case 'register':
            require_method('POST');
            $data = request_data();
            $name = trim((string) ($data['name'] ?? ''));
            $email = strtolower(trim((string) ($data['email'] ?? '')));
            $password = (string) ($data['password'] ?? '');
            if ($name === '' || utf8_length($name) > 120 || strlen($email) > 190
                || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                respond(['error' => 'Ingresa un nombre y correo válidos.'], 422);
            }
            if (strlen($password) < 8) {
                respond(['error' => 'La contraseña debe tener al menos 8 caracteres.'], 422);
            }
            try {
                $statement = $db->prepare(
                    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, "Cliente")'
                );
                $statement->execute([$name, $email, password_hash($password, PASSWORD_DEFAULT)]);
            } catch (PDOException $error) {
                if ($error->getCode() === '23000') {
                    respond(['error' => 'Ya existe una cuenta con este correo.'], 409);
                }
                throw $error;
            }
            respond(['message' => 'Cuenta creada. Ya puedes iniciar sesión.'], 201);

        case 'login':
            require_method('POST');
            $data = request_data();
            $email = strtolower(trim((string) ($data['email'] ?? '')));
            $password = (string) ($data['password'] ?? '');
            $statement = $db->prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?');
            $statement->execute([$email]);
            $user = $statement->fetch();
            if (!$user || !password_verify($password, $user['password_hash'])) {
                respond(['error' => 'Correo o contraseña incorrectos.'], 401);
            }
            session_regenerate_id(true);
            unset($user['password_hash']);
            $_SESSION['user'] = $user;
            respond(['user' => public_user($user)]);

        case 'logout':
            require_method('POST');
            $_SESSION = [];
            if (ini_get('session.use_cookies')) {
                $parameters = session_get_cookie_params();
                setcookie(session_name(), '', [
                    'expires' => time() - 42000,
                    'path' => $parameters['path'],
                    'domain' => $parameters['domain'],
                    'secure' => $parameters['secure'],
                    'httponly' => $parameters['httponly'],
                    'samesite' => 'Lax',
                ]);
            }
            session_destroy();
            respond(['message' => 'Sesión cerrada.']);

        case 'place-order':
            require_method('POST');
            $user = require_user();
            if ($user['role'] !== 'Cliente') {
                respond(['error' => 'Solo los clientes pueden realizar pedidos.'], 403);
            }
            $data = request_data();
            $items = $data['items'] ?? null;
            if (!is_array($items) || count($items) < 1 || count($items) > 50) {
                respond(['error' => 'El pedido debe contener entre 1 y 50 productos.'], 422);
            }
            $requestKey = (string) ($data['requestKey'] ?? '');
            if (!preg_match('/^[a-f0-9-]{36}$/i', $requestKey)) {
                respond(['error' => 'No se pudo validar la referencia del pedido. Recarga la página e inténtalo otra vez.'], 422);
            }

            $db->beginTransaction();
            $existingOrder = $db->prepare(
                'SELECT o.id, o.total, COALESCE(SUM(oi.quantity), 0) AS quantity
                 FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
                 WHERE o.user_id = ? AND o.request_key = ?
                 GROUP BY o.id, o.total'
            );
            $existingOrder->execute([(int) $user['id'], $requestKey]);
            $alreadyPlaced = $existingOrder->fetch();
            if ($alreadyPlaced) {
                $db->commit();
                respond(['order' => [
                    'id' => (int) $alreadyPlaced['id'],
                    'total' => (float) $alreadyPlaced['total'],
                    'quantity' => (int) $alreadyPlaced['quantity'],
                ]], 200);
            }
            $requested = [];
            foreach ($items as $item) {
                $id = filter_var($item['productId'] ?? null, FILTER_VALIDATE_INT);
                $quantity = filter_var($item['quantity'] ?? null, FILTER_VALIDATE_INT);
                if (!$id || !$quantity || $quantity < 1 || $quantity > 100) {
                    $db->rollBack();
                    respond(['error' => 'Hay cantidades o productos inválidos en el pedido.'], 422);
                }
                $requested[$id] = ($requested[$id] ?? 0) + $quantity;
                if ($requested[$id] > 100) {
                    $db->rollBack();
                    respond(['error' => 'La cantidad máxima por producto es 100.'], 422);
                }
            }

            $selectProduct = $db->prepare(
                'SELECT p.id, p.name, p.price, i.quantity
                 FROM products p JOIN inventory i ON i.product_id = p.id
                 WHERE p.id = ? AND p.is_active = 1 FOR UPDATE'
            );
            ksort($requested, SORT_NUMERIC);
            $insertOrder = $db->prepare('INSERT INTO orders (user_id, request_key, total) VALUES (?, ?, 0)');
            $insertItem = $db->prepare(
                'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, line_total)
                 VALUES (?, ?, ?, ?, ?, ?)'
            );
            $updateStock = $db->prepare('UPDATE inventory SET quantity = quantity - ? WHERE product_id = ?');
            $movement = $db->prepare(
                'INSERT INTO inventory_movements (product_id, user_id, order_id, change_quantity, reason)
                 VALUES (?, ?, ?, ?, "Venta")'
            );

            $lines = [];
            $total = 0.0;
            foreach ($requested as $productId => $quantity) {
                $selectProduct->execute([$productId]);
                $product = $selectProduct->fetch();
                if (!$product || (int) $product['quantity'] < $quantity) {
                    $db->rollBack();
                    respond(['error' => 'Stock insuficiente para uno o más productos. Actualiza el carrito e inténtalo de nuevo.'], 409);
                }
                $price = (float) $product['price'];
                $lineTotal = round($price * $quantity, 2);
                if ($total > 99999999.99 - $lineTotal) {
                    $db->rollBack();
                    respond(['error' => 'El total del pedido supera el límite permitido.'], 422);
                }
                $lines[] = [
                    'id' => (int) $product['id'],
                    'name' => $product['name'],
                    'quantity' => $quantity,
                    'price' => $price,
                    'lineTotal' => $lineTotal,
                ];
                $total += $lineTotal;
            }

            try {
                $insertOrder->execute([(int) $user['id'], $requestKey]);
            } catch (PDOException $error) {
                if ($error->getCode() !== '23000') {
                    throw $error;
                }
                $db->rollBack();
                $existingOrder->execute([(int) $user['id'], $requestKey]);
                $alreadyPlaced = $existingOrder->fetch();
                if ($alreadyPlaced) {
                    respond(['order' => [
                        'id' => (int) $alreadyPlaced['id'],
                        'total' => (float) $alreadyPlaced['total'],
                        'quantity' => (int) $alreadyPlaced['quantity'],
                    ]], 200);
                }
                throw $error;
            }
            $orderId = (int) $db->lastInsertId();
            foreach ($lines as $line) {
                $insertItem->execute([
                    $orderId, $line['id'], $line['name'], $line['quantity'],
                    $line['price'], $line['lineTotal'],
                ]);
                $updateStock->execute([$line['quantity'], $line['id']]);
                $movement->execute([$line['id'], (int) $user['id'], $orderId, -$line['quantity']]);
            }
            $updateTotal = $db->prepare('UPDATE orders SET total = ? WHERE id = ?');
            $updateTotal->execute([round($total, 2), $orderId]);
            $db->commit();
            respond([
                'order' => [
                    'id' => $orderId,
                    'total' => round($total, 2),
                    'quantity' => array_sum($requested),
                    'items' => $lines,
                ],
            ], 201);

        case 'dashboard':
            require_method('GET');
            require_admin();
            $stats = $db->query(
                'SELECT
                    (SELECT COUNT(*) FROM orders) AS order_count,
                    (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status <> "Cancelado") AS sales_total,
                    (SELECT COUNT(*) FROM products p JOIN inventory i ON i.product_id = p.id WHERE p.is_active = 1 AND i.quantity > 0) AS product_count,
                    (SELECT COUNT(*) FROM users WHERE role = "Cliente") AS customer_count'
            )->fetch();
            $inventory = $db->query(
                'SELECT p.id AS productId, p.name AS productName, p.category,
                        i.quantity AS stock, i.minimum_quantity AS minimumStock
                 FROM products p JOIN inventory i ON i.product_id = p.id
                 WHERE p.is_active = 1
                 ORDER BY (i.quantity <= i.minimum_quantity) DESC, p.name'
            )->fetchAll();
            $sales = $db->query(
                'SELECT o.id, u.name AS customer, o.total, o.status, o.created_at AS date,
                        COALESCE(SUM(oi.quantity), 0) AS quantity
                 FROM orders o JOIN users u ON u.id = o.user_id
                 LEFT JOIN order_items oi ON oi.order_id = o.id
                 GROUP BY o.id, u.name, o.total, o.status, o.created_at
                 ORDER BY o.created_at DESC LIMIT 20'
            )->fetchAll();
            $dailySales = $db->query(
                'SELECT DATE(created_at) AS sale_date, COALESCE(SUM(total), 0) AS total
                 FROM orders
                 WHERE status <> "Cancelado" AND created_at >= CURDATE() - INTERVAL 6 DAY
                 GROUP BY DATE(created_at)
                 ORDER BY sale_date'
            )->fetchAll();
            respond([
                'stats' => [
                    'orders' => (int) $stats['order_count'],
                    'sales' => (float) $stats['sales_total'],
                    'products' => (int) $stats['product_count'],
                    'customers' => (int) $stats['customer_count'],
                ],
                'inventory' => array_map(static function (array $item): array {
                    return [
                        'productId' => (int) $item['productId'],
                        'productName' => $item['productName'],
                        'category' => $item['category'],
                        'stock' => (int) $item['stock'],
                        'minimumStock' => (int) $item['minimumStock'],
                    ];
                }, $inventory),
                'sales' => array_map(static function (array $sale): array {
                    return [
                        'id' => (int) $sale['id'],
                        'customer' => $sale['customer'],
                        'total' => (float) $sale['total'],
                        'quantity' => (int) $sale['quantity'],
                        'status' => $sale['status'],
                        'date' => $sale['date'],
                    ];
                }, $sales),
                'dailySales' => array_map(static function (array $day): array {
                    return [
                        'date' => $day['sale_date'],
                        'total' => (float) $day['total'],
                    ];
                }, $dailySales),
            ]);

        case 'save-product':
            require_method('POST');
            $admin = require_admin();
            $data = request_data();
            $id = isset($data['id']) ? filter_var($data['id'], FILTER_VALIDATE_INT) : null;
            $name = trim((string) ($data['name'] ?? ''));
            $category = (string) ($data['category'] ?? '');
            $description = trim((string) ($data['description'] ?? ''));
            $image = trim((string) ($data['image'] ?? ''));
            $badge = trim((string) ($data['badge'] ?? 'De la casa'));
            $price = filter_var($data['price'] ?? null, FILTER_VALIDATE_FLOAT);
            $stock = filter_var($data['stock'] ?? null, FILTER_VALIDATE_INT);
            $minimum = filter_var($data['minimumStock'] ?? null, FILTER_VALIDATE_INT);
            if ($name === '' || utf8_length($name) > 140 || !in_array($category, ['cafe', 'frio', 'reposteria'], true)
                || $description === '' || utf8_length($description) > 500 || $price === false
                || $price <= 0 || $price > 99999999.99
                || $stock === false || $stock < 0 || $stock > 2147483647
                || $minimum === false || $minimum < 0 || $minimum > 2147483647
                || utf8_length($image) > 1000
                || ($image !== '' && (!filter_var($image, FILTER_VALIDATE_URL) || !preg_match('#^https?://#i', $image)))
                || utf8_length($badge) > 50) {
                respond(['error' => 'Revisa los campos del producto; hay valores inválidos.'], 422);
            }
            try {
                $db->beginTransaction();
                if ($id) {
                    $find = $db->prepare('SELECT quantity FROM inventory WHERE product_id = ? FOR UPDATE');
                    $find->execute([$id]);
                    $existingStock = $find->fetchColumn();
                    if ($existingStock === false) {
                        $db->rollBack();
                        respond(['error' => 'El producto no existe.'], 404);
                    }
                    $save = $db->prepare(
                        'UPDATE products SET name = ?, category = ?, price = ?, badge = ?,
                         description = ?, image_url = ? WHERE id = ?'
                    );
                    $save->execute([$name, $category, $price, $badge, $description, $image, $id]);
                    $saveInventory = $db->prepare(
                        'UPDATE inventory SET quantity = ?, minimum_quantity = ? WHERE product_id = ?'
                    );
                    $saveInventory->execute([$stock, $minimum, $id]);
                    $change = $stock - (int) $existingStock;
                    if ($change !== 0) {
                        $movement = $db->prepare(
                            'INSERT INTO inventory_movements (product_id, user_id, change_quantity, reason)
                             VALUES (?, ?, ?, "Ajuste")'
                        );
                        $movement->execute([$id, (int) $admin['id'], $change]);
                    }
                } else {
                    $insert = $db->prepare(
                        'INSERT INTO products (name, category, price, badge, description, image_url)
                         VALUES (?, ?, ?, ?, ?, ?)'
                    );
                    $insert->execute([$name, $category, $price, $badge, $description, $image]);
                    $id = (int) $db->lastInsertId();
                    $insertInventory = $db->prepare(
                        'INSERT INTO inventory (product_id, quantity, minimum_quantity) VALUES (?, ?, ?)'
                    );
                    $insertInventory->execute([$id, $stock, $minimum]);
                    if ($stock > 0) {
                        $movement = $db->prepare(
                            'INSERT INTO inventory_movements (product_id, user_id, change_quantity, reason)
                             VALUES (?, ?, ?, "Carga inicial")'
                        );
                        $movement->execute([$id, (int) $admin['id'], $stock]);
                    }
                }
                $db->commit();
                respond(['message' => 'Producto guardado.', 'id' => (int) $id]);
            } catch (PDOException $error) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                if ($error->getCode() === '23000') {
                    respond(['error' => 'Ya existe un producto con ese nombre.'], 409);
                }
                throw $error;
            }

        case 'delete-product':
            require_method('POST');
            require_admin();
            $data = request_data();
            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            if (!$id) {
                respond(['error' => 'Identificador de producto inválido.'], 422);
            }
            $statement = $db->prepare('UPDATE products SET is_active = 0 WHERE id = ? AND is_active = 1');
            $statement->execute([$id]);
            if ($statement->rowCount() === 0) {
                respond(['error' => 'El producto no existe.'], 404);
            }
            respond(['message' => 'Producto eliminado.']);

        default:
            respond(['error' => 'Acción de API no reconocida.'], 404);
    }
} catch (Throwable $error) {
    error_log('[Hearth & Bean API] ' . $error->getMessage());
    respond(['error' => 'Error interno del servidor. Revisa la conexión a MySQL y los registros de PHP.'], 500);
}
