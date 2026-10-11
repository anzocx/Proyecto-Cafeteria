CREATE DATABASE IF NOT EXISTS hearthbean
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE hearthbean;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('Administrador', 'Cliente') NOT NULL DEFAULT 'Cliente',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(140) NOT NULL,
  category ENUM('cafe', 'frio', 'reposteria') NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  badge VARCHAR(50) NOT NULL DEFAULT 'De la casa',
  description VARCHAR(500) NOT NULL,
  image_url VARCHAR(1000) NOT NULL DEFAULT '',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_name (name),
  CONSTRAINT chk_products_price CHECK (price > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  product_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 0,
  minimum_quantity INT UNSIGNED NOT NULL DEFAULT 8,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id),
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  request_key CHAR(36) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status ENUM('Recibido', 'Preparando', 'Listo', 'Entregado', 'Cancelado')
    NOT NULL DEFAULT 'Recibido',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_user_request (user_id, request_key),
  KEY idx_orders_created_at (created_at),
  KEY idx_orders_user_id (user_id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_orders_total CHECK (total >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(140) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order_items_order_id (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE SET NULL,
  CONSTRAINT chk_order_items_quantity CHECK (quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  order_id BIGINT UNSIGNED NULL,
  change_quantity INT NOT NULL,
  reason ENUM('Carga inicial', 'Compra', 'Venta', 'Ajuste') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inventory_movements_product_date (product_id, created_at),
  CONSTRAINT fk_inventory_movements_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_movements_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_movements_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT chk_inventory_movement_nonzero CHECK (change_quantity <> 0)
) ENGINE=InnoDB;

INSERT INTO products (name, category, price, badge, description, image_url)
VALUES
  ('Latte Artesanal', 'cafe', 18.00, 'Especial', 'Espresso suave con leche al vapor y notas de vainilla.', 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=900&q=80'),
  ('Cappuccino Clásico', 'cafe', 16.00, 'Top', 'Cuerpo intenso con espuma cremosa y cacao.', 'https://images.unsplash.com/photo-1497636577773-f1231844b336?auto=format&fit=crop&w=900&q=80'),
  ('Cold Brew', 'frio', 17.00, 'Frío', 'Infusión lenta con un perfil dulce y refrescante.', 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=900&q=80'),
  ('Iced Mocha', 'frio', 19.00, 'Nuevo', 'Café, chocolate y hielo con acabado sedoso.', 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=900&q=80'),
  ('Croissant de Mantequilla', 'reposteria', 9.00, 'Horno', 'Capas suaves, doradas y con mantequilla premium.', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80'),
  ('Brownie de Cacao', 'reposteria', 11.00, 'Famoso', 'Textura húmeda e intensa, aún mejor con café.', 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=80'),
  ('Matcha Latte', 'frio', 18.00, 'Verde', 'Matcha suave con leche cremosa y toque de miel.', 'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=900&q=80'),
  ('Affogato', 'cafe', 15.00, 'Delicia', 'Helado de vainilla bañado con espresso caliente.', 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?auto=format&fit=crop&w=900&q=80')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO inventory (product_id, quantity, minimum_quantity)
SELECT id,
  CASE name
    WHEN 'Latte Artesanal' THEN 18
    WHEN 'Cappuccino Clásico' THEN 16
    WHEN 'Cold Brew' THEN 12
    WHEN 'Iced Mocha' THEN 9
    WHEN 'Croissant de Mantequilla' THEN 22
    WHEN 'Brownie de Cacao' THEN 14
    WHEN 'Matcha Latte' THEN 7
    WHEN 'Affogato' THEN 10
  END,
  CASE WHEN category = 'reposteria' THEN 6 ELSE 8 END
FROM products
ON DUPLICATE KEY UPDATE product_id = VALUES(product_id);

INSERT INTO inventory_movements (product_id, change_quantity, reason)
SELECT i.product_id, i.quantity, 'Carga inicial'
FROM inventory i
WHERE i.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM inventory_movements m WHERE m.product_id = i.product_id
  );
