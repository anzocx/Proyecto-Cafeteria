<?php
declare(strict_types=1);

require_once __DIR__ . '/api/config.php';
start_app_session();

$message = '';
$error = '';
$adminCount = 0;
$csrfToken = $_SESSION['setup_csrf'] ?? bin2hex(random_bytes(32));
$_SESSION['setup_csrf'] = $csrfToken;

try {
    $db = database();
    $adminCount = (int) $db->query(
        'SELECT COUNT(*) FROM users WHERE role = "Administrador"'
    )->fetchColumn();

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        if (!hash_equals($csrfToken, (string) ($_POST['csrf_token'] ?? ''))) {
            $error = 'La solicitud de configuración expiró. Recarga la página e inténtalo otra vez.';
        } elseif ($adminCount > 0) {
            $error = 'Ya existe un administrador. Elimina este archivo de configuración.';
        } else {
            $name = trim((string) ($_POST['name'] ?? ''));
            $email = strtolower(trim((string) ($_POST['email'] ?? '')));
            $password = (string) ($_POST['password'] ?? '');
            if ($name === '' || utf8_length($name) > 120 || strlen($email) > 190
                || !filter_var($email, FILTER_VALIDATE_EMAIL)
                || strlen($password) < 12) {
                $error = 'Completa los datos correctamente. La contraseña debe tener al menos 12 caracteres.';
            } else {
                $statement = $db->prepare(
                    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, "Administrador")'
                );
                $statement->execute([$name, $email, password_hash($password, PASSWORD_DEFAULT)]);
                $message = 'Administrador creado. Elimina setup-admin.php por seguridad y ya puedes iniciar sesión.';
                $adminCount = 1;
                unset($_SESSION['setup_csrf']);
            }
        }
    }
} catch (Throwable $exception) {
    error_log('[Hearth & Bean setup] ' . $exception->getMessage());
    $error = $exception instanceof PDOException && $exception->getCode() === '23000'
        ? 'Ese correo ya está registrado. Usa otro correo para el administrador.'
        : 'No se pudo conectar con MySQL. Verifica XAMPP, la importación del esquema y api/config.php.';
}
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Configurar administrador | Hearth &amp; Bean</title>
  <link rel="stylesheet" href="public/assets/css/styles.css">
</head>
<body class="account-page">
  <main class="cafe-auth-main">
    <section class="cafe-auth-card">
      <p class="eyebrow">Configuración inicial</p>
      <h1>Crear administrador</h1>
      <?php if ($error !== ''): ?><p role="alert"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p><?php endif; ?>
      <?php if ($message !== ''): ?><p role="status"><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></p><?php endif; ?>
      <?php if ($adminCount > 0 && $message === ''): ?>
        <p>Ya existe un administrador. Elimina este archivo por seguridad.</p>
      <?php endif; ?>
      <?php if ($adminCount === 0): ?>
      <form method="post" class="auth-form">
        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
        <label class="field">Nombre
          <input name="name" maxlength="120" required autocomplete="name">
        </label>
        <label class="field">Correo
          <input name="email" type="email" maxlength="190" required autocomplete="email">
        </label>
        <label class="field">Contraseña (mínimo 12 caracteres)
          <input name="password" type="password" minlength="12" required autocomplete="new-password">
        </label>
        <button class="modal-submit" type="submit">Crear administrador</button>
      </form>
      <?php endif; ?>
      <p><a href="public/">Volver a la cafetería</a></p>
    </section>
  </main>
</body>
</html>
