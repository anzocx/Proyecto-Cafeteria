# Hearth & Bean: PHP y MySQL

La aplicación utiliza una API PHP con sesiones de servidor. Usuarios, catálogo, inventario,
movimientos, pedidos y ventas se guardan en MySQL; no se usan `localStorage` ni credenciales
de demostración para autenticar.

## Instalación en XAMPP

1. Copia la carpeta del proyecto dentro de `C:\xampp\htdocs\` (por ejemplo, como
   `C:\xampp\htdocs\hearthbean`).
2. Abre el panel de XAMPP e inicia **Apache** y **MySQL**.
3. Abre `http://localhost/phpmyadmin`, selecciona **Importar** e importa
   `database/database.sql`.
   El script crea la base de datos `hearthbean`, sus tablas y los productos iniciales.
4. Si MySQL no usa el usuario `root` sin contraseña, actualiza los valores de conexión en
   `api/config.php` (o define `HEARTHBEAN_DB_HOST`, `HEARTHBEAN_DB_NAME`,
   `HEARTHBEAN_DB_USER` y `HEARTHBEAN_DB_PASSWORD` en el entorno de PHP).
5. Abre `http://localhost/hearthbean/setup-admin.php` y crea la primera cuenta de
   administrador. Usa una contraseña de al menos 12 caracteres.
6. **Elimina `setup-admin.php` después de crear el administrador.**
7. Abre `http://localhost/hearthbean/` para usar el sitio. El administrador inicia sesión
   desde el botón de acceso; los clientes pueden crear una cuenta desde Registro.

La estructura separa las páginas en `public/`, sus estilos y scripts en `public/assets/`,
la API en `api/` y el esquema MySQL en `database/`. La raíz redirige automáticamente a
`public/`; la carpeta `database/` bloquea el acceso web al archivo SQL. No abras los HTML directamente con
`file://`: PHP debe ejecutarse bajo Apache para que la API `api/index.php` pueda gestionar
la sesión y la base de datos.

## Datos y operaciones

- `users`: cuentas y hashes de contraseñas generados con `password_hash`.
- `products`: menú, descripción, categoría y precio.
- `inventory`: existencias y nivel mínimo por producto.
- `inventory_movements`: entradas iniciales, ajustes y salidas por venta.
- `orders` y `order_items`: ventas y precios/cantidades guardados como historial.
- Los productos retirados quedan archivados para preservar el historial y no se muestran
  en el menú.

Confirmar un pedido bloquea las filas de inventario implicadas y guarda pedido, líneas,
descuento de existencias y movimientos dentro de una transacción MySQL. Si el stock no
alcanza, no se registra la venta ni se descuentan unidades.

## Requisitos

- PHP 8.0 o posterior, con extensiones PDO y PDO_MYSQL habilitadas.
- MySQL 8 o MariaDB compatible con InnoDB.
