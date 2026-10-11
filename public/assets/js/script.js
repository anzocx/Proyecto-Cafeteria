async function apiRequest(action, { method = 'GET', body } = {}) {
  const response = await fetch(`../api/index.php?action=${encodeURIComponent(action)}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('El servidor devolvió una respuesta no válida. Revisa Apache y PHP.');
  }
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la solicitud.');
  return payload;
}

const FALLBACK_PRODUCT_IMAGE = 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=900&q=80';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function showToast(message, type = 'success', duration = 4000) {
  const stack = document.querySelector('.toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  const timer = document.createElement('span');
  timer.className = 'toast-timer';
  timer.setAttribute('aria-label', 'Segundos restantes');
  const progress = document.createElement('span');
  progress.className = 'toast-progress';
  progress.style.animationDuration = `${duration}ms`;
  toast.append(text, timer, progress);
  stack.append(toast);

  const start = Date.now();
  const interval = window.setInterval(() => {
    const remaining = Math.max(0, duration - (Date.now() - start));
    timer.textContent = `${Math.ceil(remaining / 1000)}s`;
    if (!remaining) {
      window.clearInterval(interval);
      toast.remove();
    }
  }, 200);
  timer.textContent = `${Math.ceil(duration / 1000)}s`;
}

async function logout() {
  try {
    await apiRequest('logout', { method: 'POST', body: {} });
  } catch (error) {
    showToast(error.message, 'error');
    return;
  }
  window.location.href = 'index.html';
}

function showFieldError(input, message) {
  if (!input) return;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  const error = document.querySelector(`[data-error-for="${input.id}"]`);
  if (error) error.textContent = message;
}

function validateForm(form) {
  let valid = true;
  form.querySelectorAll('[required]').forEach(input => {
    let message = '';
    if (input.validity.valueMissing) message = 'Este campo es obligatorio.';
    else if (input.validity.typeMismatch) message = 'Ingresa un correo válido.';
    else if (input.validity.tooShort) message = `Usa al menos ${input.minLength} caracteres.`;
    showFieldError(input, message);
    if (message) valid = false;
  });
  return valid;
}

function clearErrors(form) {
  form.querySelectorAll('[aria-invalid="true"]').forEach(input => showFieldError(input, ''));
}

async function initHome() {
  const cart = [];
  let activeFilter = 'all';
  let products = [];
  let currentUser = null;
  let orderRequestKey = null;
  let orderSubmitting = false;
  try {
    const [productResult, sessionResult] = await Promise.all([
      apiRequest('products'),
      apiRequest('me'),
    ]);
    products = productResult.products;
    currentUser = sessionResult.user;
  } catch (error) {
    showToast(error.message, 'error', 8000);
  }
  const productGrid = document.querySelector('#productGrid');
  const filterButtons = document.querySelectorAll('.filter-button');
  const cartCount = document.querySelector('#cartCount');
  const loginModal = document.querySelector('#loginModal');
  const authForm = document.querySelector('#authForm');
  const contactForm = document.querySelector('#contactForm');
  const formSuccess = document.querySelector('#formSuccess');

  function renderProducts() {
    const visible = products.filter(product => {
      const isMatchingCategory = activeFilter === 'all' || product.category === activeFilter;
      const isAvailable = Number(product.stock || 0) > 0;
      return isMatchingCategory && isAvailable;
    });
    if (!visible.length) {
      productGrid.innerHTML = '<p class="empty-menu">No hay productos disponibles en esta categoría ahora mismo.</p>';
      return;
    }
    productGrid.innerHTML = visible.map(item => `
      <article class="product-card">
        <img class="product-image" src="${escapeHtml(item.image || FALLBACK_PRODUCT_IMAGE)}" alt="${escapeHtml(item.name)}" loading="lazy">
        <div class="product-body">
          <div class="product-meta"><span>${escapeHtml(item.badge || 'De la casa')}</span><div class="product-price">$${Number(item.price).toFixed(2)}</div></div>
          <h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p>
          <div class="product-footer">
            <span class="stock-tag">Stock: ${Number(item.stock || 0)}</span>
            <button type="button" data-add="${item.id}">Agregar al carrito</button>
          </div>
        </div>
      </article>`).join('');
  }

  function renderCart() {
    const list = document.getElementById('cartItems');
    const empty = document.getElementById('cartEmpty');
    const totalElement = document.getElementById('cartTotal');
    const totalCount = cart.reduce((sum, row) => sum + row.quantity, 0);
    const total = cart.reduce((sum, row) => sum + row.product.price * row.quantity, 0);
    cartCount.textContent = String(totalCount);
    totalElement.textContent = `$${total.toFixed(2)}`;
    document.getElementById('placeOrder').disabled = !cart.length;
    empty.hidden = cart.length > 0;
    list.innerHTML = cart.map(row => `<article class="cart-item"><div class="cart-item-copy"><strong>${escapeHtml(row.product.name)}</strong><small>$${row.product.price.toFixed(2)} c/u</small></div><div class="cart-item-controls"><button type="button" data-cart-action="minus" data-id="${row.product.id}" aria-label="Quitar una unidad">−</button><span>${row.quantity}</span><button type="button" data-cart-action="plus" data-id="${row.product.id}" aria-label="Agregar una unidad">+</button><button class="cart-remove" type="button" data-cart-action="remove" data-id="${row.product.id}" aria-label="Quitar producto">×</button></div></article>`).join('');
  }

  function addToCart(id) {
    if (orderSubmitting) return;
    const product = products.find(item => item.id === id);
    if (!product || Number(product.stock || 0) <= 0) {
      showToast('Este producto ya no tiene stock disponible.', 'error');
      return;
    }
    const existing = cart.find(row => row.product.id === id);
    if (existing && existing.quantity >= Number(product.stock || 0)) {
      showToast('No puedes agregar más unidades de este producto.', 'info');
      return;
    }
    if (existing) existing.quantity += 1;
    else cart.push({ product, quantity: 1 });
    orderRequestKey = null;
    renderCart();
    showToast(`${product.name} agregado al pedido.`);
  }

  function setCartOpen(isOpen) {
    document.getElementById('cartDrawer').classList.toggle('is-open', isOpen);
    document.getElementById('cartDrawer').setAttribute('aria-hidden', String(!isOpen));
    document.getElementById('cartBackdrop').classList.toggle('is-open', isOpen);
    document.body.classList.toggle('drawer-open', isOpen);
    if (isOpen) document.getElementById('closeCart').focus();
  }

  function openLoginModal() {
    loginModal.classList.add('is-open');
    loginModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    document.getElementById('authEmail').focus();
  }

  function closeLoginModal() {
    loginModal.classList.remove('is-open');
    loginModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function refreshHeaderUser() {
    const button = document.getElementById('loginButton');
    const adminLink = document.getElementById('adminLink');
    if (currentUser?.role === 'Administrador') {
      adminLink.hidden = false;
      button.textContent = 'Salir';
      button.setAttribute('aria-label', 'Cerrar sesión');
    } else if (currentUser) {
      adminLink.hidden = true;
      button.textContent = currentUser.name.split(' ')[0];
      button.setAttribute('aria-label', `Sesión de ${currentUser.name}`);
    } else {
      adminLink.hidden = true;
      button.textContent = 'Iniciar sesión';
    }
    button.onclick = () => {
      if (currentUser) logout();
      else openLoginModal();
    };
  }

  productGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-add]');
    if (button) addToCart(Number(button.dataset.add));
  });
  filterButtons.forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach(filter => {
      const active = filter === button;
      filter.classList.toggle('active', active);
      filter.setAttribute('aria-pressed', String(active));
    });
    renderProducts();
  }));

  document.querySelector('.cart-button').addEventListener('click', () => setCartOpen(true));
  document.getElementById('closeCart').addEventListener('click', () => setCartOpen(false));
  document.getElementById('cartBackdrop').addEventListener('click', () => setCartOpen(false));
  document.getElementById('cartItems').addEventListener('click', event => {
    if (orderSubmitting) return;
    const button = event.target.closest('[data-cart-action]');
    if (!button) return;
    const row = cart.find(item => item.product.id === Number(button.dataset.id));
    if (!row) return;
    if (button.dataset.cartAction === 'plus') {
      const stock = Number(row.product.stock || 0);
      if (row.quantity >= stock) {
        showToast('No hay suficiente stock para esta unidad.', 'info');
        return;
      }
      row.quantity += 1;
    }
    if (button.dataset.cartAction === 'minus') row.quantity -= 1;
    if (button.dataset.cartAction === 'remove' || row.quantity <= 0) cart.splice(cart.indexOf(row), 1);
    orderRequestKey = null;
    renderCart();
  });
  document.getElementById('placeOrder').addEventListener('click', async event => {
    const placeOrderButton = event.currentTarget;
    if (!currentUser || currentUser.role !== 'Cliente') {
      setCartOpen(false);
      showToast('Inicia sesión o regístrate como cliente para confirmar el pedido.', 'info');
      openLoginModal();
      return;
    }
    if (!cart.length) {
      showToast('Tu carrito está vacío.', 'error');
      return;
    }
    if (orderSubmitting) return;
    orderSubmitting = true;
    placeOrderButton.disabled = true;
    document.querySelectorAll('#cartItems button').forEach(button => { button.disabled = true; });
    orderRequestKey ||= crypto.randomUUID();

    try {
      await apiRequest('place-order', {
        method: 'POST',
        body: {
          requestKey: orderRequestKey,
          items: cart.map(row => ({ productId: row.product.id, quantity: row.quantity })),
        },
      });
    } catch (error) {
      orderSubmitting = false;
      placeOrderButton.disabled = false;
      document.querySelectorAll('#cartItems button').forEach(button => { button.disabled = false; });
      showToast(error.message, 'error', 7000);
      try {
        const productResult = await apiRequest('products');
        products = productResult.products;
        renderProducts();
      } catch (refreshError) {
        showToast(refreshError.message, 'error');
      }
      return;
    }
    orderRequestKey = null;
    orderSubmitting = false;
    cart.length = 0;
    renderCart();
    setCartOpen(false);
    showToast('Pedido recibido. ¡Gracias por elegirnos!');
    try {
      const productResult = await apiRequest('products');
      products = productResult.products;
      renderProducts();
    } catch (error) {
      showToast(`Pedido registrado. No se pudo actualizar el menú: ${error.message}`, 'info');
    }
  });

  document.getElementById('closeModal').addEventListener('click', closeLoginModal);
  loginModal.addEventListener('click', event => { if (event.target === loginModal) closeLoginModal(); });
  document.getElementById('forgotPassword').addEventListener('click', event => {
    event.preventDefault();
    showToast('Escríbenos desde Contacto para recuperar el acceso.', 'info');
  });
  authForm.addEventListener('input', event => showFieldError(event.target, ''));
  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    clearErrors(authForm);
    if (!validateForm(authForm)) return;
    const email = document.getElementById('authEmail').value.trim().toLowerCase();
    const password = document.getElementById('authPassword').value;
    try {
      const result = await apiRequest('login', {
        method: 'POST',
        body: { email, password },
      });
      currentUser = result.user;
    } catch (error) {
      showFieldError(document.getElementById('authPassword'), error.message);
      showToast(error.message, 'error');
      return;
    }
    authForm.reset();
    closeLoginModal();
    if (currentUser.role === 'Administrador') window.location.href = 'dashboard.html';
    else {
      refreshHeaderUser();
      showToast(`¡Bienvenida, ${currentUser.name}!`);
    }
  });

  contactForm.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(contactForm);
    if (![data.get('name'), data.get('email'), data.get('message')].every(value => String(value || '').trim())) {
      formSuccess.textContent = 'Completa todos los campos para enviarnos tu mensaje.';
      formSuccess.style.color = '#b95d4b';
      return;
    }
    formSuccess.textContent = '¡Gracias por escribirnos! Te responderemos pronto.';
    formSuccess.style.color = '#698066';
    showToast('Mensaje enviado. ¡Gracias!');
    contactForm.reset();
  });

  document.getElementById('mobileNavToggle')?.addEventListener('click', event => {
    const nav = document.querySelector('.main-nav');
    const open = nav.classList.toggle('is-open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.main-nav a').forEach(link => link.addEventListener('click', () => {
    document.querySelector('.main-nav').classList.remove('is-open');
    document.getElementById('mobileNavToggle')?.setAttribute('aria-expanded', 'false');
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeLoginModal();
      setCartOpen(false);
    }
  });
  if (window.location.hash === '#loginModal') openLoginModal();
  renderProducts();
  renderCart();
  refreshHeaderUser();
}

function initRegister() {
  const form = document.getElementById('registerForm');
  form.addEventListener('input', event => showFieldError(event.target, ''));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    clearErrors(form);
    if (!validateForm(form)) return;
    const password = document.getElementById('password');
    const confirm = document.getElementById('confirmPassword');
    if (password.value !== confirm.value) {
      showFieldError(confirm, 'Las contraseñas no coinciden.');
      showToast('Revisa la confirmación de contraseña.', 'error');
      return;
    }
    try {
      await apiRequest('register', {
        method: 'POST',
        body: {
          name: document.getElementById('fullName').value.trim(),
          email: document.getElementById('email').value.trim().toLowerCase(),
          password: password.value,
        },
      });
    } catch (error) {
      showToast(error.message, 'error');
      if (error.message.includes('correo')) {
        showFieldError(document.getElementById('email'), error.message);
      }
      return;
    }
    showToast('Cuenta creada. Ya puedes iniciar sesión.');
    window.setTimeout(() => { window.location.href = 'index.html#loginModal'; }, 1000);
  });
}

async function initAuthenticatedPage(page) {
  let user;
  try {
    const result = await apiRequest('me');
    user = result.user;
  } catch (error) {
    showToast(error.message, 'error');
    return;
  }
  if (!user || user.role !== 'Administrador') {
    window.location.replace('index.html#loginModal');
    return;
  }
  const name = document.getElementById('profileName');
  const role = document.getElementById('profileRole');
  const initials = document.getElementById('profileInitials');
  const sidebarName = document.getElementById('sidebarUserName');
  if (name) name.textContent = user.name;
  if (role) role.textContent = 'Administración';
  if (sidebarName) sidebarName.textContent = user.name;
  if (initials) initials.textContent = user.name.split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  document.getElementById('logoutButton').addEventListener('click', logout);

  const toggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sideMenu');
  toggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  });
  document.querySelectorAll('.nav-item').forEach(link => link.addEventListener('click', () => {
    sidebar.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir menú');
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      sidebar.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Abrir menú');
    }
  });
  if (page === 'dashboard') await renderCafeDashboard();
  if (page === 'crud') await initProductCrud();
}

async function renderCafeDashboard() {
  let data;
  try {
    data = await apiRequest('dashboard');
  } catch (error) {
    showToast(error.message, 'error', 8000);
    return;
  }
  const { stats: serverStats, inventory, sales, dailySales } = data;
  const lowStock = inventory.filter(item => Number(item.stock) <= Number(item.minimumStock)).length;
  const stats = {
    metricOrders: serverStats.orders,
    metricSales: `$${Number(serverStats.sales).toFixed(2)}`,
    metricProducts: serverStats.products,
    metricCustomers: serverStats.customers,
  };
  Object.entries(stats).forEach(([id, value]) => {
    const target = document.getElementById(id);
    if (target) target.textContent = value;
  });

  const inventoryTableBody = document.getElementById('inventoryTableBody');
  if (inventoryTableBody) {
    const rows = inventory.length ? inventory.slice(0, 6).map(item => {
      const status = Number(item.stock || 0) <= Number(item.minimumStock || 0) ? 'Bajo' : 'Normal';
      return `<tr>
        <td>${escapeHtml(item.productName || 'Producto')}</td>
        <td>${escapeHtml(item.category || 'Sin categoría')}</td>
        <td>${Number(item.stock || 0)}</td>
        <td>${Number(item.minimumStock || 0)}</td>
        <td><span class="badge ${status === 'Bajo' ? 'warning' : 'success'}">${status}</span></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-state">No hay inventario registrado.</td></tr>';
    inventoryTableBody.innerHTML = rows;
  }

  const salesTableBody = document.getElementById('salesTableBody');
  if (salesTableBody) {
    const rows = sales.length ? sales.slice(0, 5).map(order => `
      <tr>
        <td>#${escapeHtml(order.id || '—')}</td>
        <td>${escapeHtml(order.customer || 'Cliente')}</td>
        <td>${Number(order.quantity || 0)}</td>
        <td>$${Number(order.total || 0).toFixed(2)}</td>
      </tr>
    `).join('') : '<tr><td colspan="4" class="empty-state">No hay ventas registradas aún.</td></tr>';
    salesTableBody.innerHTML = rows;
  }

  const lowStockBadge = document.getElementById('lowStockCount');
  if (lowStockBadge) lowStockBadge.textContent = String(lowStock);

  const chart = document.getElementById('salesChart');
  if (chart) {
    const salesByDate = new Map(dailySales.map(day => [day.date, Number(day.total)]));
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return { date, total: salesByDate.get(key) || 0 };
    });
    const max = Math.max(1, ...days.map(day => day.total));
    chart.innerHTML = days.map(day => `
      <div class="chart-column">
        <span style="height:${Math.max(4, day.total / max * 100)}%" title="$${day.total.toFixed(2)}"></span>
        <small>${escapeHtml(day.date.toLocaleDateString('es', { weekday: 'short' }))}</small>
      </div>
    `).join('');
  }
}

async function initProductCrud() {
  const tableBody = document.getElementById('tableBody');
  const form = document.getElementById('crudForm');
  const formModal = document.getElementById('crudModal');
  const deleteModal = document.getElementById('deleteModal');
  const search = document.getElementById('searchInput');
  const categoryFilter = document.getElementById('categoryFilter');
  const availabilityFilter = document.getElementById('availabilityFilter');
  let products = (await apiRequest('products')).products;
  let editingId = null;
  let deletingId = null;
  let currentPage = 1;
  const pageSize = 5;
  const fields = {
    name: document.getElementById('nameInput'),
    category: document.getElementById('categoryInput'),
    price: document.getElementById('priceInput'),
    stock: document.getElementById('stockInput'),
    minimumStock: document.getElementById('minimumStockInput'),
    description: document.getElementById('descriptionInput'),
    image: document.getElementById('imageInput'),
  };
  const paginationInfo = document.getElementById('paginationInfo');
  const previousPage = document.getElementById('previousPage');
  const nextPage = document.getElementById('nextPage');

  function openModal(modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.setProperty('transition', 'none', 'important');
    modal.style.setProperty('opacity', '1', 'important');
    modal.style.setProperty('visibility', 'visible', 'important');
    document.body.classList.add('modal-open');
    modal.querySelector('button, input, select, textarea')?.focus();
  }
  function closeModal(modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.removeProperty('transition');
    modal.style.removeProperty('opacity');
    modal.style.removeProperty('visibility');
    if (!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-open');
  }
  async function reloadProducts() {
    const result = await apiRequest('products');
    products = result.products;
  }

  function renderTable() {
    const query = search.value.trim().toLocaleLowerCase('es');
    const category = categoryFilter.value;
    const status = availabilityFilter.value;
    const filtered = products.filter(product => `${product.name} ${product.description}`.toLocaleLowerCase('es').includes(query)
      && (!category || product.category === category)
      && (!status || product.status === status));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    currentPage = Math.min(currentPage, pages);
    const label = filtered.length === 1 ? 'producto' : 'productos';
    paginationInfo.textContent = `Página ${currentPage} de ${pages} · ${filtered.length} ${label}`;
    previousPage.disabled = currentPage <= 1;
    nextPage.disabled = currentPage >= pages;
    if (!filtered.length) {
      tableBody.innerHTML = '<tr><td class="empty-state" colspan="6">No hay productos que coincidan con estos filtros.</td></tr>';
      return;
    }
    const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    tableBody.innerHTML = pageRows.map(product => `<tr>
      <td><div class="table-product"><img src="${escapeHtml(product.image || FALLBACK_PRODUCT_IMAGE)}" alt="" loading="lazy"><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description)}</small></span></div></td>
      <td>${categoryLabel(product.category)}</td><td>$${Number(product.price).toFixed(2)}</td>
      <td>${Number(product.stock || 0)}</td>
      <td><span class="badge ${product.status === 'Disponible' ? 'success' : 'warning'}">${escapeHtml(product.status)}</span></td>
      <td><div class="table-actions"><button class="action-btn edit" type="button" data-edit="${product.id}">Editar</button><button class="action-btn delete" type="button" data-delete="${product.id}">Eliminar</button></div></td>
    </tr>`).join('');
  }

  function categoryLabel(category) {
    return ({ cafe: 'Café de especialidad', frio: 'Bebidas frías', reposteria: 'Repostería' })[category] || 'Otros';
  }
  function resetForm() {
    form.reset();
    editingId = null;
    document.getElementById('modalTitle').textContent = 'Nuevo producto';
    document.getElementById('submitCrud').textContent = 'Guardar producto';
    clearErrors(form);
  }
  function openEdit(product) {
    editingId = product.id;
    fields.name.value = product.name;
    fields.category.value = product.category;
    fields.price.value = product.price;
    fields.stock.value = product.stock ?? 0;
    fields.minimumStock.value = product.minimumStock ?? 0;
    fields.description.value = product.description;
    fields.image.value = product.image || '';
    document.getElementById('modalTitle').textContent = 'Editar producto';
    document.getElementById('submitCrud').textContent = 'Guardar cambios';
    openModal(formModal);
  }

  document.getElementById('newRecordBtn').addEventListener('click', () => {
    resetForm();
    openModal(formModal);
  });
  form.addEventListener('input', event => showFieldError(event.target, ''));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    clearErrors(form);
    if (!validateForm(form)) return;
    const price = Number(fields.price.value);
    const stock = Number(fields.stock.value);
    const minimumStock = Number(fields.minimumStock.value);
    if (!Number.isFinite(price) || price <= 0) {
      showFieldError(fields.price, 'El precio debe ser mayor que cero.');
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      showFieldError(fields.stock, 'El stock debe ser un número entero mayor o igual a cero.');
      return;
    }
    if (!Number.isInteger(minimumStock) || minimumStock < 0) {
      showFieldError(fields.minimumStock, 'El mínimo debe ser un número entero mayor o igual a cero.');
      return;
    }
    const existing = products.some(product => product.name.trim().toLowerCase() === fields.name.value.trim().toLowerCase() && product.id !== editingId);
    if (existing) {
      showFieldError(fields.name, 'Ya existe un producto con ese nombre.');
      return;
    }
    const image = fields.image.value.trim();
    if (image && !/^https?:\/\//i.test(image)) {
      showFieldError(fields.image, 'Usa una dirección de imagen que comience por http o https.');
      return;
    }
    const item = {
      id: editingId,
      name: fields.name.value.trim(), category: fields.category.value, price,
      stock, minimumStock,
      description: fields.description.value.trim(), image,
      badge: 'De la casa',
    };
    const wasNew = editingId === null;
    try {
      await apiRequest('save-product', { method: 'POST', body: item });
      await reloadProducts();
    } catch (error) {
      showToast(error.message, 'error');
      return;
    }
    currentPage = 1;
    renderTable();
    closeModal(formModal);
    showToast(wasNew ? 'Producto agregado a la carta.' : 'Producto actualizado.');
    resetForm();
  });

  tableBody.addEventListener('click', event => {
    const button = event.target.closest('[data-edit], [data-delete]');
    if (!button) return;
    const id = Number(button.dataset.edit || button.dataset.delete);
    const product = products.find(item => item.id === id);
    if (!product) return;
    if (button.dataset.edit) openEdit(product);
    else {
      deletingId = id;
      document.getElementById('deleteProductName').textContent = product.name;
      openModal(deleteModal);
    }
  });
  document.getElementById('confirmDelete').addEventListener('click', async () => {
    try {
      await apiRequest('delete-product', { method: 'POST', body: { id: deletingId } });
      await reloadProducts();
    } catch (error) {
      showToast(error.message, 'error');
      return;
    }
    renderTable();
    closeModal(deleteModal);
    showToast('Producto retirado de la carta.');
    deletingId = null;
  });
  document.querySelectorAll('[data-close-crud]').forEach(button => button.addEventListener('click', () => closeModal(button.closest('.modal-overlay'))));
  [formModal, deleteModal].forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); }));
  previousPage.addEventListener('click', () => { currentPage -= 1; renderTable(); });
  nextPage.addEventListener('click', () => { currentPage += 1; renderTable(); });
  search.addEventListener('input', () => { currentPage = 1; renderTable(); });
  categoryFilter.addEventListener('change', () => { currentPage = 1; renderTable(); });
  availabilityFilter.addEventListener('change', () => { currentPage = 1; renderTable(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') [formModal, deleteModal].forEach(closeModal);
  });
  renderTable();
}

function initDesign() {
  const form = document.getElementById('designForm');
  form?.addEventListener('input', event => showFieldError(event.target, ''));
  form?.addEventListener('submit', event => {
    event.preventDefault();
    clearErrors(form);
    if (!validateForm(form)) {
      showToast('Completa los campos obligatorios.', 'error');
      return;
    }
    const password = document.getElementById('demoPassword');
    if (password.value.length < 8) {
      showFieldError(password, 'Usa al menos 8 caracteres.');
      showToast('La contraseña debe tener 8 caracteres.', 'error');
      return;
    }
    showToast('Formulario validado correctamente.');
  });
  document.getElementById('demoToast')?.addEventListener('click', () => showToast('Toast temporal. Se cerrará en 4 segundos.'));
  [['demoModalSuccess', 'successDemoModal'], ['demoModalError', 'errorDemoModal'], ['demoModalConfirm', 'confirmDemoModal']].forEach(([buttonId, modalId]) => {
    const button = document.getElementById(buttonId);
    const modal = document.getElementById(modalId);
    button?.addEventListener('click', () => {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      modal.style.setProperty('transition', 'none', 'important');
      modal.style.opacity = '1';
      modal.style.setProperty('visibility', 'visible', 'important');
      document.body.classList.add('modal-open');
    });
  });
}

function initModalExamples() {
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => {
    const modal = button.closest('.modal-overlay');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.removeProperty('transition');
    modal.style.removeProperty('opacity');
    modal.style.removeProperty('visibility');
    if (!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-open');
  }));
  document.querySelectorAll('.modal-overlay').forEach(modal => modal.addEventListener('click', event => {
    if (event.target === modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      modal.style.removeProperty('transition');
      modal.style.removeProperty('opacity');
      modal.style.removeProperty('visibility');
      document.body.classList.remove('modal-open');
    }
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(modal => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      modal.style.removeProperty('transition');
      modal.style.removeProperty('opacity');
      modal.style.removeProperty('visibility');
      document.body.classList.remove('modal-open');
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initModalExamples();
  const page = document.body.dataset.page;
  if (page === 'home') await initHome();
  if (page === 'register') initRegister();
  if (page === 'design') initDesign();
  if (page === 'dashboard' || page === 'crud') {
    try {
      await initAuthenticatedPage(page);
    } catch (error) {
      showToast(error.message, 'error', 8000);
    }
  }
});
