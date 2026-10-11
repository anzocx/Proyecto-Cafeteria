<?php
declare(strict_types=1);

function database(): PDO
{
    static $connection = null;
    if ($connection instanceof PDO) {
        return $connection;
    }

    $host = getenv('HEARTHBEAN_DB_HOST') ?: '127.0.0.1';
    $name = getenv('HEARTHBEAN_DB_NAME') ?: 'hearthbean';
    $user = getenv('HEARTHBEAN_DB_USER') ?: 'root';
    $password = getenv('HEARTHBEAN_DB_PASSWORD') ?: '';
    $dsn = "mysql:host={$host};dbname={$name};charset=utf8mb4";

    $connection = new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $connection;
}

function utf8_length(string $value): int
{
    $count = preg_match_all('/./us', $value, $matches);
    return $count === false ? strlen($value) : $count;
}

function start_app_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.use_strict_mode', '1');
    session_set_cookie_params([
        'httponly' => true,
        'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite' => 'Lax',
        'path' => '/',
    ]);
    session_start();
}

function respond(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function request_data(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw === false ? '' : $raw, true);
    if (!is_array($data)) {
        respond(['error' => 'El cuerpo de la solicitud debe ser JSON válido.'], 400);
    }
    return $data;
}

function require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        header('Allow: ' . $method);
        respond(['error' => 'Método no permitido.'], 405);
    }
}

function current_user(): ?array
{
    if (!isset($_SESSION['user'])) {
        return null;
    }
    return $_SESSION['user'];
}

function require_user(): array
{
    $user = current_user();
    if ($user === null) {
        respond(['error' => 'Inicia sesión para continuar.'], 401);
    }
    return $user;
}

function require_admin(): array
{
    $user = require_user();
    if ($user['role'] !== 'Administrador') {
        respond(['error' => 'Se requiere una cuenta de administrador.'], 403);
    }
    return $user;
}

function public_user(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'name' => $user['name'],
        'email' => $user['email'],
        'role' => $user['role'],
    ];
}
