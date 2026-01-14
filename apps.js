// ==================== CONFIGURATION ====================

const CONFIG = {
    API_URL: window.location.origin + '/api',
    TOKEN_KEY: 'pos_auth_token',
    USER_KEY: 'pos_current_user',
    JWT_EXPIRATION_HOURS: 24
};

// ==================== STATE MANAGEMENT ====================

class AppState {
    constructor() {
        this.token = localStorage.getItem(CONFIG.TOKEN_KEY);
        this.user = JSON.parse(localStorage.getItem(CONFIG.USER_KEY) || 'null');
        this.products = [];
        this.customers = [];
        this.cart = [];
        this.selectedCustomer = null;
        this.isWholesale = false;
        this.selectedPaymentMethod = null;
        this.currentTab = 'pos';
    }

    setAuth(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem(CONFIG.TOKEN_KEY, token);
        localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
    }

    clearAuth() {
        this.token = null;
        this.user = null;
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
    }

    isAuthenticated() {
        return !!this.token;
    }
}

const state = new AppState();

// ==================== API CLIENT ====================

class APIClient {
    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers
        };

        if (state.token) {
            headers['Authorization'] = `Bearer ${state.token}`;
        }

        // Add timeout handling (10 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            console.log(`[API] ${options.method || 'GET'} ${CONFIG.API_URL}${endpoint}`);

            const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
                ...options,
                headers,
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            console.log(`[API] Response status: ${response.status}`);

            // Handle unauthorized
            if (response.status === 401) {
                UI.showAlert('Session expired. Please login again.', 'warning');
                setTimeout(() => {
                    state.clearAuth();
                    App.init();
                }, 2000);
                throw new Error('Unauthorized');
            }

            // Parse response
            let data;
            try {
                const text = await response.text();
                data = text ? JSON.parse(text) : {};
                console.log('[API] Response data:', data);
            } catch (e) {
                console.error('[API] Failed to parse JSON:', e);
                throw new Error(`Invalid response from server (${response.status})`);
            }

            // Handle error responses
            if (!response.ok) {
                const errorMessage = data.error || data.message || `Request failed with status ${response.status}`;
                console.error('[API] Error response:', errorMessage);
                throw new Error(errorMessage);
            }

            // Return the response data
            return data;
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('[API] Request failed:', error);

            if (error.name === 'AbortError') {
                throw new Error('Request timed out. Server is taking too long to respond.');
            }

            // Re-throw with more context if it's a network error
            if (error.message === 'Failed to fetch') {
                throw new Error('Cannot connect to server. Please check if services are running.');
            }

            throw error;
        }
    }

    get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    }

    post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
}

const api = new APIClient();

// ==================== UI UTILITIES ====================

class UI {
    static render(html) {
        document.getElementById('app').innerHTML = html;
    }

    static showAlert(message, type = 'info', duration = 5000) {
        const alerts = document.querySelectorAll('.alert');
        alerts.forEach(alert => alert.remove());

        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.innerHTML = `
            <span>${this.escapeHtml(message)}</span>
            <button style="margin-left: auto; background: none; border: none; font-size: 18px; cursor: pointer;" onclick="this.parentElement.remove()">×</button>
        `;

        const container = document.querySelector('.container') || document.body;
        container.insertBefore(alert, container.firstChild);

        if (duration > 0) {
            setTimeout(() => alert.remove(), duration);
        }
    }

    static escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    static formatCurrency(amount) {
        return `KSh ${parseFloat(amount).toFixed(2)}`;
    }

    static formatDate(dateString) {
        return new Date(dateString).toLocaleDateString();
    }

    static formatDateTime(dateString) {
        return new Date(dateString).toLocaleString();
    }

    static showLoading(container) {
        container.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading...</p>
            </div>
        `;
    }
}

// ==================== AUTHENTICATION ====================

class Auth {
    static renderLogin() {
        UI.render(`
            <div class="login-container">
                <div class="login-card">
                    <div class="login-header">
                        <h1>📦 East Africa Packaging Hub</h1>
                        <p>Point of Sale System</p>
                    </div>

                    <!-- Login Form -->
                    <form id="loginForm">
                        <div class="form-group">
                            <label class="form-label">Username</label>
                            <input type="text" class="form-control" id="loginUsername" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Password</label>
                            <input type="password" class="form-control" id="loginPassword" required>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block">Login</button>
                        <div id="loginStatus" style="margin-top: 15px;"></div>
                        <div style="text-align: center; margin-top: 20px; color: var(--text-light);">
                            <p>Don't have an account? <a href="#" id="showRegister" style="color: var(--primary); text-decoration: none;">Create Account</a></p>
                        </div>
                    </form>

                    <!-- Register Form -->
                    <form id="registerForm" class="hidden">
                        <div class="form-group">
                            <label class="form-label">Username</label>
                            <input type="text" class="form-control" id="registerUsername" minlength="3" required>
                            <small style="color: var(--text-light); font-size: 12px;">At least 3 characters</small>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Password</label>
                            <input type="password" class="form-control" id="registerPassword" minlength="6" required>
                            <small style="color: var(--text-light); font-size: 12px;">At least 6 characters</small>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Confirm Password</label>
                            <input type="password" class="form-control" id="registerPasswordConfirm" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Role</label>
                            <select class="form-control" id="registerRole">
                                <option value="cashier">Cashier</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block">Create Account</button>
                        <div id="registerStatus" style="margin-top: 15px;"></div>
                        <div style="text-align: center; margin-top: 20px; color: var(--text-light);">
                            <p>Already have an account? <a href="#" id="showLogin" style="color: var(--primary); text-decoration: none;">Login</a></p>
                        </div>
                    </form>
                </div>
            </div>
        `);

        // Event listeners
        document.getElementById('loginForm').addEventListener('submit', this.handleLogin.bind(this));
        document.getElementById('registerForm').addEventListener('submit', this.handleRegister.bind(this));
        document.getElementById('showRegister').addEventListener('click', this.showRegisterForm.bind(this));
        document.getElementById('showLogin').addEventListener('click', this.showLoginForm.bind(this));
    }

    static showRegisterForm(e) {
        e.preventDefault();
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('registerForm').classList.remove('hidden');
    }

    static showLoginForm(e) {
        e.preventDefault();
        document.getElementById('registerForm').classList.add('hidden');
        document.getElementById('loginForm').classList.remove('hidden');
    }

    static async handleLogin(e) {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        const status = document.getElementById('loginStatus');

        try {
            status.innerHTML = '<div class="alert alert-info">Logging in...</div>';

            const response = await api.post('/auth/login', { username, password });

            // Handle response structure: { success: true, data: { token, user }, message }
            if (response.token) {
                state.setAuth(response.token, response.user);
                UI.showAlert('Login successful!', 'success');
                setTimeout(() => App.init(), 500);
            } else {
                throw new Error(response.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            status.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        }
    }

    static async handleRegister(e) {
        e.preventDefault();
        const username = document.getElementById('registerUsername').value.trim();
        const password = document.getElementById('registerPassword').value;
        const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
        const role = document.getElementById('registerRole').value;
        const status = document.getElementById('registerStatus');

        // Validate password match
        if (password !== passwordConfirm) {
            status.innerHTML = '<div class="alert alert-danger">Passwords do not match</div>';
            return;
        }

        // Validate username length
        if (username.length < 3) {
            status.innerHTML = '<div class="alert alert-danger">Username must be at least 3 characters long</div>';
            return;
        }

        // Validate password length
        if (password.length < 6) {
            status.innerHTML = '<div class="alert alert-danger">Password must be at least 6 characters long</div>';
            return;
        }

        try {
            status.innerHTML = '<div class="alert alert-info">Creating account...</div>';

            const response = await api.post('/auth/register', { username, password, role });

            // Handle response structure: { success: true, data: { token, user }, message }
            if (response.token) {
                state.setAuth(response.token, response.user);
                UI.showAlert('Account created successfully!', 'success');
                setTimeout(() => App.init(), 500);
            } else {
                throw new Error(response.error || 'Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            status.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        }
    }

    static logout() {
        if (confirm('Are you sure you want to logout?')) {
            state.clearAuth();
            App.init();
        }
    }
}

// ==================== PRODUCT MANAGEMENT ====================

class Products {
    static async load(search = '') {
        try {
            const query = search ? `&search=${encodeURIComponent(search)}` : '';
            const data = await api.get(`/products?per_page=100${query}`);
            state.products = data.products || [];
            localStorage.setItem('cached_products', JSON.stringify(state.products));
            localStorage.setItem('cached_products_ts', new Date().toISOString());
            this.render();
            this.renderManagement();
        } catch (error) {
            console.warn('Loading products from cache due to error:', error);
            const cached = localStorage.getItem('cached_products');
            const timestamp = localStorage.getItem('cached_products_ts');
            if (cached) {
                state.products = JSON.parse(cached);
                const lastUpdated = timestamp ? new Date(timestamp).toLocaleString() : 'Unknown';
                UI.showAlert(`Loaded products from cache (Offline). Last updated: ${lastUpdated}`, 'warning');
                this.render();
                this.renderManagement();
            } else {
                UI.showAlert(`Failed to load products: ${error.message}`, 'danger');
            }
        }
    }

    static render() {
        const grid = document.getElementById('productsGrid');
        if (!grid) return;

        if (state.products.length === 0) {
            grid.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-light);">
                    <div style="font-size: 48px; margin-bottom: 10px;">📦</div>
                    <h3>No products found</h3>
                    <p>Add some products to get started.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = state.products.map(product => `
            <div class="product-card ${this.getCardClass(product)}" 
                 onclick="Cart.addItem(${product.id})"
                 data-product-id="${product.id}">
                <div class="product-name">${UI.escapeHtml(product.name)}</div>
                <div class="product-price">${UI.formatCurrency(state.isWholesale ? (product.wholesale_price || product.price) : product.price)}</div>
                <div class="product-stock">
                    <span>Stock: ${product.quantity} ${product.unit}</span>
                    ${product.low_stock ? '<span class="badge badge-warning">Low</span>' : ''}
                    ${product.quantity === 0 ? '<span class="badge badge-danger">Out</span>' : ''}
                </div>
            </div>
        `).join('');
    }

    static getCardClass(product) {
        if (product.quantity === 0) return 'out-of-stock';
        if (product.low_stock) return 'low-stock';
        return '';
    }

    static filter() {
        const search = document.getElementById('productSearch').value.toLowerCase();
        const filtered = state.products.filter(p => 
            p.name.toLowerCase().includes(search) || 
            p.sku.toLowerCase().includes(search)
        );

        const grid = document.getElementById('productsGrid');
        if (filtered.length === 0) {
            grid.innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <h3>No products found</h3>
                </div>
            `;
            return;
        }

        grid.innerHTML = filtered.map(product => `
            <div class="product-card ${this.getCardClass(product)}" 
                 onclick="Cart.addItem(${product.id})">
                <div class="product-name">${UI.escapeHtml(product.name)}</div>
                <div class="product-price">${UI.formatCurrency(product.price)}</div>
                <div class="product-stock">Stock: ${product.quantity}</div>
            </div>
        `).join('');
    }

    static renderManagement() {
        const container = document.getElementById('productsManagementTable');
        if (!container) return;

        container.innerHTML = `
            <div class="table-responsive">
                <div style="margin-bottom: 15px; display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="btn btn-secondary" onclick="Modal.open('importProductModal')">📥 Import CSV</button>
                    <button class="btn btn-secondary" onclick="Products.downloadExport('csv')">📤 Export CSV</button>
                    <button class="btn btn-secondary" onclick="Products.downloadExport('pdf')">📄 Export PDF</button>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>SKU</th>
                            <th>Category</th>
                            <th>Price</th>
                            <th>Wholesale</th>
                            <th>Stock</th>
                            <th>Unit</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.products.map(p => `
                            <tr>
                                <td>${UI.escapeHtml(p.name)}</td>
                                <td>${p.sku}</td>
                                <td>${p.category || '-'}</td>
                                <td>${UI.formatCurrency(p.price)}</td>
                                <td>${UI.formatCurrency(p.wholesale_price || p.price)}</td>
                                <td><span class="${p.quantity <= p.reorder_level ? 'text-danger' : ''}">${p.quantity}</span></td>
                                <td>${p.unit}</td>
                                <td>
                                    <button class="btn btn-sm btn-primary" onclick="Products.openEditModal(${p.id})" title="Edit">✏️</button>
                                    <button class="btn btn-sm btn-warning" onclick="Products.openStockModal(${p.id})" title="Manage Stock">📦</button>
                                    <button class="btn btn-sm btn-danger" onclick="Products.confirmDelete(${p.id})" title="Delete">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    static async downloadExport(format) {
        try {
            const endpoint = format === 'pdf' ? '/export/products/pdf' : '/export/products';
            const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
                headers: { 'Authorization': `Bearer ${state.token}` }
            });
            
            if (!response.ok) throw new Error('Export failed');
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `products.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            UI.showAlert('Failed to download export', 'danger');
        }
    }

    static async add(formData) {
        try {
            await api.post('/products', formData);
            UI.showAlert('Product added successfully!', 'success');
            Modal.close('addProductModal');
            await this.load();
        } catch (error) {
            UI.showAlert(error.message, 'danger');
        }
    }

    static openEditModal(id) {
        const product = state.products.find(p => p.id === id);
        if (!product) return;
        
        document.getElementById('editProductId').value = product.id;
        document.getElementById('editProductName').value = product.name;
        document.getElementById('editProductSku').value = product.sku;
        document.getElementById('editProductCategory').value = product.category || '';
        document.getElementById('editProductDescription').value = product.description || '';
        document.getElementById('editProductPrice').value = product.price;
        document.getElementById('editProductWholesalePrice').value = product.wholesale_price || product.price;
        document.getElementById('editProductCost').value = product.cost;
        document.getElementById('editProductReorder').value = product.reorder_level;
        document.getElementById('editProductUnit').value = product.unit;
        
        Modal.open('editProductModal');
    }

    static async update(id, formData) {
        try {
            await api.put(`/products/${id}`, formData);
            UI.showAlert('Product updated successfully', 'success');
            Modal.close('editProductModal');
            this.load();
        } catch (error) {
            UI.showAlert(error.message, 'danger');
        }
    }

    static openStockModal(id) {
        const product = state.products.find(p => p.id === id);
        if (!product) return;
        
        document.getElementById('stockProductId').value = product.id;
        document.getElementById('stockProductName').textContent = product.name;
        
        const qtyDisplay = document.getElementById('stockCurrentQuantity');
        qtyDisplay.textContent = product.quantity + ' ' + product.unit;
        qtyDisplay.dataset.value = product.quantity;
        qtyDisplay.dataset.unit = product.unit;

        document.getElementById('stockType').value = 'in';
        document.getElementById('stockQuantity').value = '';
        document.getElementById('stockNotes').value = '';
        
        this.updateStockPreview();
        Modal.open('stockModal');
    }

    static handleStockTypeChange() {
        const type = document.getElementById('stockType').value;
        const qtyInput = document.getElementById('stockQuantity');
        const currentQty = parseInt(document.getElementById('stockCurrentQuantity').dataset.value || 0);
        
        if (type === 'adjustment') {
            qtyInput.value = currentQty;
        } else {
            qtyInput.value = '';
        }
        this.updateStockPreview();
    }

    static updateStockPreview() {
        const qtyDisplay = document.getElementById('stockCurrentQuantity');
        const currentStock = parseInt(qtyDisplay.dataset.value || 0);
        const unit = qtyDisplay.dataset.unit || '';
        
        const type = document.getElementById('stockType').value;
        const inputQty = parseInt(document.getElementById('stockQuantity').value);
        const qty = (isNaN(inputQty) || inputQty < 0) ? 0 : inputQty;
        
        let newStock = currentStock;
        if (type === 'in') newStock += qty;
        else if (type === 'out') newStock -= qty;
        else if (type === 'adjustment') newStock = qty;
        
        const el = document.getElementById('stockNewQuantity');
        if (el) {
            el.textContent = newStock + ' ' + unit;
            el.style.color = newStock < 0 ? 'var(--danger)' : 'var(--primary)';
        }
    }

    static async adjustStock(formData) {
        try {
            await api.post('/stock/movement', formData);
            UI.showAlert('Stock updated successfully', 'success');
            Modal.close('stockModal');
            this.load();
        } catch (error) {
            UI.showAlert(error.message, 'danger');
        }
    }

    static confirmDelete(id) {
        const product = state.products.find(p => p.id === id);
        if (!product) return;
        
        if(confirm(`Are you sure you want to delete ${product.name}?`)) {
             this.delete(id);
        }
    }

    static async delete(id) {
        try {
            await api.delete(`/products/${id}`);
            UI.showAlert('Product deleted successfully', 'success');
            this.load();
        } catch (error) {
            UI.showAlert(error.message, 'danger');
        }
    }
}

// ==================== CUSTOMER MANAGEMENT ====================

class Customers {
    static async load(search = '') {
        try {
            const query = search ? `&search=${encodeURIComponent(search)}` : '';
            const data = await api.get(`/customers?per_page=100${query}`);
            state.customers = data.customers || [];
            localStorage.setItem('cached_customers', JSON.stringify(state.customers));
            localStorage.setItem('cached_customers_ts', new Date().toISOString());
            this.renderManagement();
        } catch (error) {
            const cached = localStorage.getItem('cached_customers');
            const timestamp = localStorage.getItem('cached_customers_ts');
            if (cached) {
                state.customers = JSON.parse(cached);
                const lastUpdated = timestamp ? new Date(timestamp).toLocaleString() : 'Unknown';
                UI.showAlert(`Loaded customers from cache. Last updated: ${lastUpdated}`, 'warning');
                this.renderManagement();
            } else {
                UI.showAlert(`Failed to load customers: ${error.message}`, 'danger');
            }
        }
    }

    static select(customerId) {
        state.selectedCustomer = state.customers.find(c => c.id === customerId);
        if (state.selectedCustomer) {
            document.getElementById('selectedCustomerName').textContent = state.selectedCustomer.name;
            document.getElementById('customerBadge').style.display = 'flex';
            Modal.close('customerModal');
            UI.showAlert(`Customer ${state.selectedCustomer.name} selected`, 'success');
        }
    }

    static renderManagement() {
        const container = document.getElementById('customersManagementTable');
        if (!container) return;

        container.innerHTML = `
            <div class="table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Company</th>
                            <th>Balance</th>
                            <th>Credit Limit</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.customers.map(c => `
                            <tr>
                                <td>${UI.escapeHtml(c.name)}</td>
                                <td>${c.phone || '-'}</td>
                                <td>${c.company || '-'}</td>
                                <td>${UI.formatCurrency(c.current_balance)}</td>
                                <td>${UI.formatCurrency(c.credit_limit)}</td>
                                <td>
                                    <button class="btn btn-sm btn-danger" onclick="Customers.confirmDelete(${c.id})" title="Delete">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    static clear() {
        state.selectedCustomer = null;
        document.getElementById('customerBadge').style.display = 'none';
    }

    static async add(formData) {
        try {
            await api.post('/customers', formData);
            UI.showAlert('Customer added successfully!', 'success');
            Modal.close('addCustomerModal');
            await this.load();
        } catch (error) {
            UI.showAlert(error.message, 'danger');
        }
    }

    static confirmDelete(id) {
        const customer = state.customers.find(c => c.id === id);
        if (!customer) return;
        
        if(confirm(`Are you sure you want to delete ${customer.name}?`)) {
             this.delete(id);
        }
    }

    static async delete(id) {
        try {
            await api.delete(`/customers/${id}`);
            UI.showAlert('Customer deleted successfully', 'success');
            this.load();
            if (window.customerSelector) window.customerSelector.loadCustomers();
        } catch (error) {
            UI.showAlert(error.message, 'danger');
        }
    }
}

// ==================== SCROLLABLE CUSTOMER SELECTOR ====================

class CustomerSelector {
    constructor() {
        this.customers = [];
        this.selectedCustomer = null;
    }

    async loadCustomers(search = '') {
        try {
            const data = await api.get(`/customers?search=${encodeURIComponent(search)}&per_page=100`);
            this.customers = data.customers || [];
            if (!search) {
                localStorage.setItem('cached_customer_selector', JSON.stringify(this.customers));
                localStorage.setItem('cached_customer_selector_ts', new Date().toISOString());
            }
            this.renderCustomerList();
        } catch (error) {
            if (!search) {
                const cached = localStorage.getItem('cached_customer_selector');
                const timestamp = localStorage.getItem('cached_customer_selector_ts');
                if (cached) {
                    this.customers = JSON.parse(cached);
                    const lastUpdated = timestamp ? new Date(timestamp).toLocaleString() : 'Unknown';
                    UI.showAlert(`Loaded customers from cache. Last updated: ${lastUpdated}`, 'warning');
                    this.renderCustomerList();
                    return;
                }
            }
            UI.showAlert(`Failed to load customers: ${error.message}`, 'danger');
        }
    }

    renderCustomerList() {
        const container = document.getElementById('customerModalList');
        if (!container) return;

        if (this.customers.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-light);">
                    <div style="font-size: 48px; margin-bottom: 10px;">👥</div>
                    <h4>No customers found</h4>
                    <p>Add customers to enable customer selection.</p>
                </div>
            `;
            return;
        }

        // Create scrollable container
        container.innerHTML = `
            <div style="margin-bottom: 15px;">
                <input type="text" 
                       class="form-control" 
                       placeholder="Search customers..." 
                       id="customerSearchInput"
                       oninput="customerSelector.searchCustomers(this.value)">
            </div>
            <div style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius);">
                ${this.customers.map(customer => `
                    <div class="customer-item" 
                         onclick="customerSelector.selectCustomer(${customer.id})"
                         style="padding: 12px; border-bottom: 1px solid var(--border); cursor: pointer; transition: all 0.3s ease;"
                         onmouseover="this.style.background='var(--dark-lighter)'"
                         onmouseout="this.style.background='transparent'">
                        <div style="font-weight: 600;">${UI.escapeHtml(customer.name)}</div>
                        <div style="font-size: 12px; color: var(--text-light); margin-top: 4px;">
                            ${customer.phone ? `📞 ${UI.escapeHtml(customer.phone)}` : ''}
                            ${customer.company ? ` • 🏢 ${UI.escapeHtml(customer.company)}` : ''}
                        </div>
                        <div style="font-size: 11px; color: var(--text-light); margin-top: 2px;">
                            Balance: ${UI.formatCurrency(customer.current_balance)}
                            ${customer.current_balance > customer.credit_limit ? ' • ⚠️ Over limit' : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top: 10px; text-align: center;">
                <button class="btn btn-warning" onclick="customerSelector.selectWalkIn()" style="margin-right: 10px;">
                    🚶 Walk-in Sale
                </button>
                <button class="btn btn-primary" onclick="Modal.open('addCustomerModal')">
                    ➕ Add New Customer
                </button>
            </div>
        `;
    }

    searchCustomers(searchTerm) {
        const filteredCustomers = this.customers.filter(customer => 
            customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (customer.phone && customer.phone.includes(searchTerm)) ||
            (customer.company && customer.company.toLowerCase().includes(searchTerm.toLowerCase()))
        );
        
        const container = document.getElementById('customerModalList');
        if (!container) return;

        if (filteredCustomers.length === 0) {
            container.querySelector('[style*="max-height: 300px"]').innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--text-light);">
                    No customers match your search
                </div>
            `;
            return;
        }

        const scrollableContainer = container.querySelector('[style*="max-height: 300px"]');
        scrollableContainer.innerHTML = filteredCustomers.map(customer => `
            <div class="customer-item" 
                 onclick="customerSelector.selectCustomer(${customer.id})"
                 style="padding: 12px; border-bottom: 1px solid var(--border); cursor: pointer; transition: all 0.3s ease;"
                 onmouseover="this.style.background='var(--dark-lighter)'"
                 onmouseout="this.style.background='transparent'">
                <div style="font-weight: 600;">${UI.escapeHtml(customer.name)}</div>
                <div style="font-size: 12px; color: var(--text-light); margin-top: 4px;">
                    ${customer.phone ? `📞 ${UI.escapeHtml(customer.phone)}` : ''}
                    ${customer.company ? ` • 🏢 ${UI.escapeHtml(customer.company)}` : ''}
                </div>
            </div>
        `).join('');
    }

    selectCustomer(customerId) {
        const customer = this.customers.find(c => c.id === customerId);
        if (customer) {
            state.selectedCustomer = customer;
            this.updateCustomerDisplay();
            Modal.close('customerModal');
            UI.showAlert(`Customer ${customer.name} selected`, 'success');
        }
    }

    selectWalkIn() {
        state.selectedCustomer = null;
        this.updateCustomerDisplay();
        Modal.close('customerModal');
        UI.showAlert('Walk-in sale selected', 'info');
    }

    updateCustomerDisplay() {
        const badge = document.getElementById('customerBadge');
        const nameDisplay = document.getElementById('selectedCustomerName');
        
        if (badge && nameDisplay) {
            if (state.selectedCustomer) {
                nameDisplay.textContent = state.selectedCustomer.name;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
        
        // Update cart display if exists
        if (window.Cart) {
            Cart.render();
        }
    }

    clearCustomer() {
        state.selectedCustomer = null;
        this.updateCustomerDisplay();
        UI.showAlert('Customer cleared', 'info');
    }
}

// Initialize global customer selector
const customerSelector = new CustomerSelector();

// ==================== CART MANAGEMENT ====================

class Cart {
    static addItem(productId) {
        const product = state.products.find(p => p.id === productId);
        if (!product) return;

        if (product.quantity <= 0) {
            UI.showAlert(`${product.name} is out of stock`, 'warning');
            return;
        }

        const existingItem = state.cart.find(item => item.product.id === productId);
        
        if (existingItem) {
            if (existingItem.quantity < product.quantity) {
                existingItem.quantity++;
                existingItem.subtotal = existingItem.quantity * existingItem.unit_price;
            } else {
                UI.showAlert(`Only ${product.quantity} units available`, 'warning');
                return;
            }
        } else {
            state.cart.push({
                product: product,
                quantity: 1,
                unit_price: state.isWholesale ? (product.wholesale_price || product.price) : product.price,
                subtotal: state.isWholesale ? (product.wholesale_price || product.price) : product.price
            });
        }

        this.render();
        UI.showAlert(`Added ${product.name} to cart`, 'success', 2000);
    }

    static updateQuantity(productId, newQuantity) {
        const item = state.cart.find(item => item.product.id === productId);
        if (!item) return;

        if (isNaN(newQuantity) || newQuantity < 1) {
            if (newQuantity === 0) {
                this.removeItem(productId);
                return;
            }
            this.render(); // Reset to previous valid value
            return;
        }

        if (newQuantity > item.product.quantity) {
            UI.showAlert(`Only ${item.product.quantity} units available`, 'warning');
            this.render(); // Reset to previous valid value
            return;
        }

        item.quantity = newQuantity;
        item.subtotal = item.quantity * item.unit_price;
        this.render();
    }

    static removeItem(productId) {
        state.cart = state.cart.filter(item => item.product.id !== productId);
        this.render();
    }

    static clear(silent = false) {
        if (state.cart.length === 0) return;
        
        if (silent || confirm('Clear the cart?')) {
            state.cart = [];
            this.render();
        }
    }

    static render() {
        const cartItems = document.getElementById('cartItems');
        const checkoutBtn = document.getElementById('checkoutBtn');

        if (!cartItems) return;

        if (state.cart.length === 0) {
            cartItems.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-light);">
                    <div style="font-size: 48px; margin-bottom: 10px;">🛒</div>
                    <h4>Cart is empty</h4>
                </div>
            `;
            this.updateTotals();
            if (checkoutBtn) checkoutBtn.disabled = true;
            return;
        }

        cartItems.innerHTML = state.cart.map(item => `
            <div class="cart-item">
                <div class="cart-item-info" style="flex: 1;">
                    <div style="font-weight: 600;">${UI.escapeHtml(item.product.name)}</div>
                    <div style="font-size: 12px; color: var(--text-light);">
                        ${UI.formatCurrency(item.unit_price)} × ${item.quantity}
                    </div>
                </div>
                <div class="cart-item-controls">
                    <span style="font-weight: 600; color: var(--primary);">${UI.formatCurrency(item.subtotal)}</span>
                    <input type="number" 
                           class="form-control" 
                           style="width: 70px; padding: 4px; text-align: center; margin: 0 5px; display: inline-block;"
                           value="${item.quantity}" 
                           min="1" 
                           max="${item.product.quantity}"
                           onchange="Cart.updateQuantity(${item.product.id}, parseInt(this.value))"
                           onkeydown="if(event.key === 'Enter') this.blur()">
                    <button class="qty-btn remove-btn" onclick="Cart.removeItem(${item.product.id})">×</button>
                </div>
            </div>
        `).join('');

        this.updateTotals();
        if (checkoutBtn) checkoutBtn.disabled = false;
    }

    static updateTotals() {
        const subtotal = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
        const tax = 0;
        const discount = 0;
        const total = subtotal + tax - discount;

        const elements = {
            subtotal: document.getElementById('subtotal'),
            tax: document.getElementById('tax'),
            discount: document.getElementById('discount'),
            total: document.getElementById('total')
        };

        if (elements.subtotal) elements.subtotal.textContent = UI.formatCurrency(subtotal);
        if (elements.tax) elements.tax.textContent = UI.formatCurrency(tax);
        if (elements.discount) elements.discount.textContent = UI.formatCurrency(discount);
        if (elements.total) elements.total.textContent = UI.formatCurrency(total);
    }

    static getTotal() {
        const subtotal = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
        const tax = 0;
        return subtotal + tax;
    }
}

// ==================== SALES MANAGEMENT ====================

class Sales {
    static lastInvoiceNumber = null;
    static lastReceiptData = null;

    static printLastReceipt() {
        if (this.lastInvoiceNumber) {
            this.printReceipt(this.lastInvoiceNumber, this.lastReceiptData);
        }
    }

    static showPaymentModal() {
        if (state.cart.length === 0) {
            UI.showAlert('Cart is empty', 'warning');
            return;
        }

        const total = Cart.getTotal();
        document.getElementById('paymentTotal').textContent = UI.formatCurrency(total);
        
        state.selectedPaymentMethod = null;
        document.getElementById('paymentDiscount').value = '0';
        document.getElementById('paymentNotes').value = '';
        
        document.querySelectorAll('.payment-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        
        Modal.open('paymentModal');
    }

    static selectPaymentMethod(method, event) {
        state.selectedPaymentMethod = method;
        
        document.querySelectorAll('.payment-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        
        if (event && event.target) {
            const el = event.target.closest('.payment-option');
            if (el) el.classList.add('selected');
        }
    }

    static updatePaymentTotal() {
        const subtotal = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
        const tax = 0;
        let discount = parseFloat(document.getElementById('paymentDiscount').value) || 0;
        if (discount < 0) discount = 0;
        const total = Math.max(0, subtotal + tax - discount);
        
        document.getElementById('paymentTotal').textContent = UI.formatCurrency(total);
    }

    static async printReceipt(invoiceNumber, receiptData = null) {
        try {
            let receipt;
            // Use provided data if it looks complete (has items)
            if (receiptData && receiptData.items) {
                receipt = receiptData;
            } else if (this.lastReceiptData && this.lastReceiptData.invoice_number === invoiceNumber && this.lastReceiptData.items) {
                receipt = this.lastReceiptData;
            } else {
                receipt = await api.get(`/receipts/${invoiceNumber}`);
            }
            
            // Create a hidden iframe for printing
            let printFrame = document.getElementById('printFrame');
            if (!printFrame) {
                printFrame = document.createElement('iframe');
                printFrame.id = 'printFrame';
                printFrame.style.display = 'none';
                document.body.appendChild(printFrame);
            }
            
            const doc = printFrame.contentWindow.document;
            doc.open();
            doc.write(`
                <html>
                <head>
                    <title>Receipt ${receipt.invoice_number}</title>
                    <style>
                        body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; margin: 0 auto; padding: 10px; }
                        .header { text-align: center; margin-bottom: 10px; }
                        .divider { border-top: 1px dashed #000; margin: 5px 0; }
                        .item { display: flex; justify-content: space-between; margin: 3px 0; }
                        .totals { margin-top: 10px; text-align: right; }
                        .footer { text-align: center; margin-top: 20px; font-size: 10px; }
                        @media print {
                            @page { margin: 0; size: auto; }
                            body { margin: 0; padding: 5px; }
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h3 style="margin: 0 0 5px 0;">EAST AFRICA PACKAGING HUB</h3>
                        <p style="margin: 2px 0;">Kenya House Complex, 1st Floor Shop F34</p>
                        <p style="margin: 2px 0;">Contact: 0704736664</p>
                        <p style="margin: 2px 0;">Date: ${new Date(receipt.date).toLocaleString()}</p>
                        <p style="margin: 2px 0;">Invoice: ${receipt.invoice_number}</p>
                        <p style="margin: 2px 0;">Served by: ${receipt.cashier}</p>
                    </div>
                    <div class="divider"></div>
                    ${receipt.items.map(item => `
                        <div class="item">
                            <span>${item.quantity} x ${item.product_name}</span>
                            <span>${UI.formatCurrency(item.subtotal)}</span>
                        </div>
                    `).join('')}
                    <div class="divider"></div>
                    <div class="totals">
                        <div class="item"><span>Subtotal:</span> <span>${UI.formatCurrency(receipt.subtotal)}</span></div>
                        <div class="item"><span>Discount:</span> <span>${UI.formatCurrency(receipt.discount)}</span></div>
                        <div class="item" style="font-weight: bold; font-size: 14px; margin-top: 5px;">
                            <span>TOTAL:</span> <span>${UI.formatCurrency(receipt.total)}</span>
                        </div>
                    </div>
                    <div class="divider"></div>
                    <div class="footer">
                        <p style="margin: 2px 0;">Payment: ${receipt.payment_method.toUpperCase()}</p>
                        <p style="margin: 2px 0;">Customer: ${receipt.customer.name}</p>
                        <p style="margin: 10px 0;">Thank you for your business!</p>
                    </div>
                </body>
                </html>
            `);
            doc.close();
            
            setTimeout(() => {
                printFrame.contentWindow.focus();
                printFrame.contentWindow.print();
            }, 100);

        } catch (error) {
            console.error(error);
            UI.showAlert('Failed to print receipt', 'danger');
        }
    }

    static async complete() {
        if (!state.selectedPaymentMethod) {
            UI.showAlert('Please select a payment method', 'warning');
            return;
        }

        if (state.selectedPaymentMethod === 'credit' && !state.selectedCustomer) {
            UI.showAlert('Customer is required for credit sales', 'warning');
            return;
        }

        const btn = document.getElementById('completeSaleBtn');
        if (!btn) return;
        const originalText = btn.innerHTML;

        try {
            btn.disabled = true;
            btn.innerHTML = '⏳ Processing...';

            const subtotal = state.cart.reduce((sum, item) => sum + item.subtotal, 0);
            const tax = 0;
            const discount = parseFloat(document.getElementById('paymentDiscount').value) || 0;
            if (discount < 0) {
                UI.showAlert('Discount cannot be negative', 'warning');
                return;
            }
            const total = Math.max(0, subtotal + tax - discount);

            const saleData = {
                items: state.cart.map(item => ({
                    product_id: item.product.id,
                    quantity: item.quantity,
                    unit_price: item.unit_price
                })),
                payment_method: state.selectedPaymentMethod,
                customer_id: state.selectedCustomer?.id,
                tax_rate: 0,
                discount: discount,
                notes: document.getElementById('paymentNotes').value
            };

            let result;
            try {
                result = await api.post('/sales', saleData);
            } catch (error) {
                if (!navigator.onLine || error.message.includes('Cannot connect') || error.message.includes('Failed to fetch')) {
                    result = OfflineManager.queueSale(saleData);
                } else {
                    throw error;
                }
            }

            // Store invoice number and show print button in cart area
            this.lastInvoiceNumber = result.sale.invoice_number;
            this.lastReceiptData = result.sale;
            const printBtn = document.getElementById('printLastBtn');
            if (printBtn) printBtn.style.display = 'block';

            // Show success modal with print option
            const completeModal = document.getElementById('saleCompleteModal');
            if (completeModal) {
                document.getElementById('completedSaleInfo').textContent = `Invoice #${result.sale.invoice_number} - ${UI.formatCurrency(result.sale.total)}`;
                document.getElementById('btnLastReceipt').onclick = () => Sales.printReceipt(result.sale.invoice_number, result.sale);
                Modal.open('saleCompleteModal');
            }
            
            Modal.close('paymentModal');
            Cart.clear(true);
            Customers.clear();
            state.selectedPaymentMethod = null;
            
            // 
            // Reload products to update stock levels
            if (navigator.onLine) {
                await Products.load();
            } else {
                // Optimistic update
                saleData.items.forEach(item => {
                    const p = state.products.find(p => p.id === item.product_id);
                    if (p) p.quantity -= item.quantity;
                });
                Products.render();
            }

        } catch (error) {
            UI.showAlert(error.message, 'danger');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    static async loadHistory(search = '') {
        try {
            const container = document.getElementById('salesTable');
            if (!container) return;

            UI.showLoading(container);

            const query = search ? `&search=${encodeURIComponent(search)}` : '';
            const data = await api.get(`/sales?per_page=50${query}`);
            const sales = data.sales || [];

            if (sales.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px;">
                        <div style="font-size: 48px; margin-bottom: 10px;">🧾</div>
                        <h3>No sales yet</h3>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="table-responsive" style="overflow-x: auto;">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Invoice</th>
                                <th>Date</th>
                                <th>Customer</th>
                                <th>Items</th>
                                <th>Total</th>
                                <th>Payment</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sales.map(sale => `
                                <tr>
                                    <td><strong>${sale.invoice_number}</strong></td>
                                    <td>${UI.formatDate(sale.created_at)}</td>
                                    <td>${sale.customer_name || 'Walk-in'}</td>
                                    <td>${sale.items_count} items</td>
                                    <td><strong>${UI.formatCurrency(sale.total)}</strong></td>
                                    <td><span class="badge badge-success">${sale.payment_method}</span></td>
                                    <td>
                                        <button class="btn btn-sm btn-primary" onclick="Sales.printReceipt('${sale.invoice_number}')">
                                            🖨️ Print
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

        } catch (error) {
            UI.showAlert('Failed to load sales history', 'danger');
        }
    }
}

// ==================== REPORTS ====================

class Reports {
    static async loadDashboard() {
        try {
            const container = document.getElementById('dashboardStats');
            if (!container) return;

            const data = await api.get('/dashboard/stats');

            container.innerHTML = `
                <div class="stat-card">
                    <div class="stat-value">${UI.formatCurrency(data.today_revenue)}</div>
                    <div class="stat-label">Today's Revenue</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.today_transactions}</div>
                    <div class="stat-label">Today's Transactions</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${UI.formatCurrency(data.monthly_revenue)}</div>
                    <div class="stat-label">Monthly Revenue</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.total_customers}</div>
                    <div class="stat-label">Total Customers</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.total_products}</div>
                    <div class="stat-label">Total Products</div>
                </div>
                <div class="stat-card ${data.low_stock_alerts > 0 ? 'warning' : ''}">
                    <div class="stat-value">${data.low_stock_alerts}</div>
                    <div class="stat-label">Low Stock Alerts</div>
                </div>
            `;
        } catch (error) {
            UI.showAlert('Failed to load dashboard stats', 'danger');
        }
    }

    static async generate() {
        const reportType = document.getElementById('reportType').value;
        const startDate = document.getElementById('reportStartDate').value;
        const endDate = document.getElementById('reportEndDate').value;
        const content = document.getElementById('reportContent');

        const btnPdf = document.getElementById('btnDownloadPdf');
        if (btnPdf) btnPdf.style.display = 'none';

        if (!reportType) {
            UI.showAlert('Please select a report type', 'warning');
            return;
        }

        try {
            UI.showLoading(content);

            let data;
            let endpoint = '';

            switch (reportType) {
                case 'daily':
                case 'monthly':
                case 'yearly':
                    endpoint = `/reports/sales?type=${reportType}&date=${startDate}`;
                    data = await api.get(endpoint);
                    this.renderSalesReport(content, data);
                    break;
                case 'inventory':
                    data = await api.get('/reports/inventory');
                    this.renderInventoryReport(content, data);
                    break;
                case 'products':
                    endpoint = `/reports/product-performance?start_date=${startDate}&end_date=${endDate}`;
                    data = await api.get(endpoint);
                    this.renderProductReport(content, data);
                    break;
            }

            if (btnPdf && ['daily', 'monthly', 'yearly'].includes(reportType)) {
                btnPdf.style.display = 'inline-block';
            }

        } catch (error) {
            content.innerHTML = '<div class="alert alert-danger">Failed to generate report</div>';
        }
    }

    static async downloadPDF() {
        const reportType = document.getElementById('reportType').value;
        const startDate = document.getElementById('reportStartDate').value;
        
        if (!reportType) return;
        
        try {
            if (['daily', 'monthly', 'yearly'].includes(reportType)) {
                const endpoint = `/reports/sales/pdf?type=${reportType}&date=${startDate}`;
                const response = await fetch(`${CONFIG.API_URL}${endpoint}`, {
                    headers: { 'Authorization': `Bearer ${state.token}` }
                });
                
                if (!response.ok) throw new Error('Download failed');
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `sales_report_${reportType}_${startDate}.pdf`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }
        } catch (error) {
            UI.showAlert('Failed to download PDF', 'danger');
        }
    }

    static renderSalesReport(container, data) {
        const paymentBreakdown = Object.entries(data.payment_breakdown || {})
            .map(([method, amount]) => `<tr><td>${method}</td><td>${UI.formatCurrency(amount)}</td></tr>`)
            .join('');

        const titles = {
            'daily': 'Daily Sales Report',
            'monthly': 'Monthly Sales Report',
            'yearly': 'Yearly Sales Report'
        };

        container.innerHTML = `
            <h3>📊 ${titles[data.period] || 'Sales Report'} - ${data.date}</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${UI.formatCurrency(data.total_sales)}</div>
                    <div class="stat-label">Total Sales</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.transactions_count}</div>
                    <div class="stat-label">Transactions</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${UI.formatCurrency(data.total_tax)}</div>
                    <div class="stat-label">Tax Collected</div>
                </div>
            </div>
            <h4>Payment Methods</h4>
            <table class="table">
                <thead><tr><th>Method</th><th>Amount</th></tr></thead>
                <tbody>${paymentBreakdown}</tbody>
            </table>
        `;
    }

    static renderInventoryReport(container, data) {
        container.innerHTML = `
            <h3>📦 Inventory Report</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${data.total_products}</div>
                    <div class="stat-label">Total Products</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${UI.formatCurrency(data.total_value)}</div>
                    <div class="stat-label">Total Value</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.low_stock_count}</div>
                    <div class="stat-label">Low Stock</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.out_of_stock_count}</div>
                    <div class="stat-label">Out of Stock</div>
                </div>
            </div>
            ${data.low_stock_items && data.low_stock_items.length > 0 ? `
                <h4>⚠️ Low Stock Items</h4>
                <table class="table">
                    <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Reorder Level</th></tr></thead>
                    <tbody>
                        ${data.low_stock_items.map(item => `
                            <tr>
                                <td>${UI.escapeHtml(item.name)}</td>
                                <td>${item.sku}</td>
                                <td style="color: var(--warning); font-weight: 600;">${item.quantity}</td>
                                <td>${item.reorder_level}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : ''}
        `;
    }

    static renderProductReport(container, data) {
        if (!data || data.length === 0) {
            container.innerHTML = '<div class="alert alert-info">No sales data found</div>';
            return;
        }

        container.innerHTML = `
            <h3>📈 Product Performance</h3>
            <table class="table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Units Sold</th>
                        <th>Revenue</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.slice(0, 20).map((product, index) => `
                        <tr>
                            <td><strong>#${index + 1}</strong></td>
                            <td>${UI.escapeHtml(product.name)}</td>
                            <td>${product.sku}</td>
                            <td>${product.total_sold}</td>
                            <td><strong>${UI.formatCurrency(product.total_revenue)}</strong></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
}

// ==================== MODAL MANAGEMENT ====================

class Modal {
   static open(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        
        if (modalId === 'customerModal') {
            // Load customers when modal opens
            customerSelector.loadCustomers();
        }
    }
}

    static close(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }

    static closeAll() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    }
}

// ==================== TAB MANAGEMENT ====================

class Tabs {
    static show(tabName, btn) {
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
        document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
        
        const tabContent = document.getElementById(tabName + 'Tab');
        if (tabContent) {
            tabContent.classList.remove('hidden');
        }
        
        if (btn) {
            btn.classList.add('active');
        }
        state.currentTab = tabName;

        switch(tabName) {
            case 'reports':
                Reports.loadDashboard();
                break;
            case 'sales':
                Sales.loadHistory();
                break;
            case 'products':
                Products.load();
                break;
            case 'customers':
                Customers.load();
                break;
        }
    }
}

// ==================== FORM HANDLERS ====================

class Forms {
   static async handleAddCustomer(e) {
    e.preventDefault();
    
    const formData = {
        name: document.getElementById('customerName').value,
        phone: document.getElementById('customerPhone').value,
        email: document.getElementById('customerEmail').value,
        company: document.getElementById('customerCompany').value,
        address: document.getElementById('customerAddress').value,
        credit_limit: parseFloat(document.getElementById('customerCredit').value) || 0
    };

    try {
        await api.post('/customers', formData);
        UI.showAlert('Customer added successfully!', 'success');
        Modal.close('addCustomerModal');
        
        // Refresh customer list and select the new customer
        await Customers.load();
        await customerSelector.loadCustomers();
        Modal.open('customerModal');
        
        if (state.currentTab === 'pos') {
            Modal.open('customerModal');
        }
    } catch (error) {
        UI.showAlert(error.message, 'danger');
    }
}
    static async handleImportProducts(e) {
        e.preventDefault();
        const fileInput = document.getElementById('importFile');
        const file = fileInput.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        // UI Feedback
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Importing...';
        btn.disabled = true;

        try {
            const response = await fetch(`${CONFIG.API_URL}/import/products`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${state.token}` },
                body: formData
            });
            
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Import failed');
            }

            if (result.errors && result.errors.length > 0) {
                UI.showAlert(`Imported ${result.message}. Check console for ${result.errors.length} errors.`, 'warning');
                console.warn('Import errors:', result.errors);
            } else {
                UI.showAlert(result.message || 'Products imported successfully', 'success');
            }
            
            Modal.close('importProductModal');
            Products.load();
            fileInput.value = ''; // Reset input
        } catch (error) {
            UI.showAlert(error.message, 'danger');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
    static async handleAddProduct(e) {
        e.preventDefault();
        
        const formData = {
            name: document.getElementById('productName').value,
            sku: document.getElementById('productSku').value,
            category: document.getElementById('productCategory').value,
            description: document.getElementById('productDescription').value,
            price: parseFloat(document.getElementById('productPrice').value),
            wholesale_price: parseFloat(document.getElementById('productWholesalePrice').value) || 0,
            cost: parseFloat(document.getElementById('productCost').value) || 0,
            quantity: parseInt(document.getElementById('productQuantity').value) || 0,
            reorder_level: parseInt(document.getElementById('productReorder').value) || 10,
            unit: document.getElementById('productUnit').value
        };

        await Products.add(formData);
    }

    static async handleEditProduct(e) {
        e.preventDefault();
        const id = document.getElementById('editProductId').value;
        const formData = {
            name: document.getElementById('editProductName').value,
            sku: document.getElementById('editProductSku').value,
            category: document.getElementById('editProductCategory').value,
            description: document.getElementById('editProductDescription').value,
            price: parseFloat(document.getElementById('editProductPrice').value),
            wholesale_price: parseFloat(document.getElementById('editProductWholesalePrice').value) || 0,
            cost: parseFloat(document.getElementById('editProductCost').value) || 0,
            reorder_level: parseInt(document.getElementById('editProductReorder').value) || 10,
            unit: document.getElementById('editProductUnit').value
        };
        await Products.update(id, formData);
    }

    static async handleStockAdjustment(e) {
        e.preventDefault();
        
        const quantity = parseInt(document.getElementById('stockQuantity').value);
        if (isNaN(quantity) || quantity < 0) {
            UI.showAlert('Please enter a valid quantity', 'warning');
            return;
        }

        const formData = {
            product_id: parseInt(document.getElementById('stockProductId').value),
            quantity: quantity,
            movement_type: document.getElementById('stockType').value,
            notes: document.getElementById('stockNotes').value
        };
        await Products.adjustStock(formData);
    }
}

// ==================== OFFLINE MANAGER ====================

class OfflineManager {
    static init() {
        window.addEventListener('online', () => {
            UI.showAlert('Back online! Syncing data...', 'info');
            this.sync();
        });
        window.addEventListener('offline', () => {
            UI.showAlert('You are offline. Working in offline mode.', 'warning');
        });

        if (navigator.onLine) {
            this.sync();
        }
    }

    static queueSale(saleData) {
        const queue = JSON.parse(localStorage.getItem('offline_sales_queue') || '[]');
        saleData._offlineId = Date.now();
        saleData._offlineDate = new Date().toISOString();
        queue.push(saleData);
        localStorage.setItem('offline_sales_queue', JSON.stringify(queue));
        
        // Calculate totals for receipt
        const subtotal = saleData.items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
        const tax = subtotal * (saleData.tax_rate || 16) / 100;
        const discount = saleData.discount || 0;
        const total = subtotal + tax - discount;
        
        // Construct receipt object
        return {
            sale: {
                invoice_number: 'OFFLINE-' + saleData._offlineId,
                date: saleData._offlineDate,
                created_at: saleData._offlineDate,
                customer: state.selectedCustomer || { name: 'Walk-in' },
                items: saleData.items.map(item => {
                    const p = state.products.find(p => p.id === item.product_id);
                    return {
                        product_name: p ? p.name : 'Unknown',
                        quantity: item.quantity,
                        unit_price: item.unit_price,
                        subtotal: item.unit_price * item.quantity
                    };
                }),
                subtotal: subtotal,
                tax: tax,
                discount: discount,
                total: total,
                payment_method: saleData.payment_method,
                cashier: state.user ? state.user.username : 'Offline User'
            }
        };
    }

    static async sync() {
        const queue = JSON.parse(localStorage.getItem('offline_sales_queue') || '[]');
        if (queue.length === 0) return;

        const failed = [];
        let successCount = 0;

        for (const saleData of queue) {
            try {
                const { _offlineId, _offlineDate, ...data } = saleData;
                await api.post('/sales', data);
                successCount++;
            } catch (error) {
                console.error('Sync failed for sale', saleData, error);
                failed.push(saleData);
            }
        }

        localStorage.setItem('offline_sales_queue', JSON.stringify(failed));

        if (successCount > 0) {
            UI.showAlert(`Synced ${successCount} offline sales.`, 'success');
            Products.load();
            Sales.loadHistory();
        }
        
        if (failed.length > 0) {
            UI.showAlert(`${failed.length} sales failed to sync.`, 'warning');
        }
    }
}

// ==================== MAIN APP ====================

class App {
    static async init() {
        if (!state.isAuthenticated()) {
            Auth.renderLogin();
            return;
        }

        OfflineManager.init();
        this.renderMain();
        await this.loadInitialData();
        this.setupEventListeners();
        this.setDefaultDates();
    }

    static setPricingMode(mode) {
        state.isWholesale = (mode === 'wholesale');
        const wholesaleBtn = document.getElementById('wholesaleBtn');
        const retailBtn = document.getElementById('retailBtn');
        
        if (wholesaleBtn) wholesaleBtn.className = state.isWholesale ? 'btn btn-warning' : 'btn btn-secondary';
        if (retailBtn) retailBtn.className = !state.isWholesale ? 'btn btn-primary' : 'btn btn-secondary';
        
        Products.render();
    }

    static renderMain() {
        UI.render(`
            <div class="container">
                <div class="header">
                    <h1>📦 East Africa Packaging Hub</h1>
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <span>Welcome, ${UI.escapeHtml(state.user.username)}</span>
                        <button class="btn btn-danger" onclick="Auth.logout()">Logout</button>
                    </div>
                </div>

                <div class="nav-tabs">
                    <button class="nav-tab active" onclick="Tabs.show('pos', this)">📦 Point of Sale</button>
                    <button class="nav-tab" onclick="Tabs.show('products', this)">🏷️ Products</button>
                    <button class="nav-tab" onclick="Tabs.show('customers', this)">👥 Customers</button>
                    <button class="nav-tab" onclick="Tabs.show('reports', this)">📈 Reports</button>
                    <button class="nav-tab" onclick="Tabs.show('sales', this)">🧾 Sales History</button>
                </div>

                ${this.renderPOSTab()}
                ${this.renderProductsTab()}
                ${this.renderCustomersTab()}
                ${this.renderReportsTab()}
                ${this.renderSalesTab()}
                ${this.renderModals()}
            </div>
        `);
    }

    static renderPOSTab() {
    return `
        <div id="posTab" class="tab-content">
            <div class="main-grid">
                <div class="card">
                    <div class="card-header">
                        <span>Products</span>
                        <div style="margin-left: 10px; display: flex; gap: 5px;">
                            <button id="retailBtn" class="btn btn-primary" style="padding: 5px 10px; font-size: 12px;" onclick="App.setPricingMode('retail')">Retail</button>
                            <button id="wholesaleBtn" class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="App.setPricingMode('wholesale')">Wholesale</button>
                        </div>
                        <input type="text" class="form-control" style="max-width: 300px;" 
                               placeholder="Search..." id="productSearch" 
                               oninput="Products.filter()">
                    </div>
                    <div class="products-grid" id="productsGrid">
                        <div class="loading"><div class="spinner"></div></div>
                    </div>
                </div>

                <div class="cart card">
                    <div class="card-header">
                        🛒 Shopping Cart
                        ${state.selectedCustomer ? 
                            `<span style="font-size: 12px; color: var(--success); margin-left: 10px;">
                                👤 ${UI.escapeHtml(state.selectedCustomer.name)}
                            </span>` : 
                            `<span style="font-size: 12px; color: var(--warning); margin-left: 10px;">
                                🚶 Walk-in
                            </span>`
                        }
                    </div>
                    
                    <!-- Enhanced Customer Selection -->
                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <button class="btn btn-primary" style="flex: 1;" onclick="customerSelector.loadCustomers(); Modal.open('customerModal')">
                            👥 Select Customer
                        </button>
                        ${state.selectedCustomer ? `
                            <button class="btn btn-danger" onclick="customerSelector.clearCustomer()" style="width: 40px;">
                                ×
                            </button>
                        ` : ''}
                    </div>

                    <div class="cart-items" id="cartItems">
                        <p style="text-align: center; padding: 20px;">Cart is empty</p>
                    </div>

                    <!-- Rest of your cart summary remains the same -->
                    <div class="cart-summary">
                        <div class="summary-row">
                            <span>Subtotal:</span>
                            <span id="subtotal">KSh 0.00</span>
                        </div>
                        <div class="summary-row">
                            <span>Tax (0%):</span>
                            <span id="tax">KSh 0.00</span>
                        </div>
                        <div class="summary-row">
                            <span>Discount:</span>
                            <span id="discount">KSh 0.00</span>
                        </div>
                        <div class="summary-row total">
                            <span>Total:</span>
                            <span id="total">KSh 0.00</span>
                        </div>
                    </div>

                    <button class="btn btn-success btn-block" onclick="Sales.showPaymentModal()" 
                            id="checkoutBtn" disabled>
                        💰 Complete Sale
                    </button>
                    <button class="btn btn-secondary btn-block" onclick="Sales.printLastReceipt()" 
                            id="printLastBtn" style="display: none; margin-top: 10px;">
                        🖨️ Print Last Receipt
                    </button>
                    <button class="btn btn-danger btn-block" onclick="Cart.clear()">
                        🗑️ Clear Cart
                    </button>
                </div>
            </div>
        </div>
    `;
}
    static renderProductsTab() {
        return `
            <div id="productsTab" class="tab-content hidden">
                <div class="card">
                    <div class="card-header">
                        <span>Product Management</span>
                        <div style="display: flex; gap: 10px;">
                            <input type="text" class="form-control" placeholder="Search products..." style="width: 200px;" onchange="Products.load(this.value)">
                            <button class="btn btn-primary" onclick="Modal.open('addProductModal')">+ Add Product</button>
                        </div>
                    </div>
                    <div id="productsManagementTable"></div>
                </div>
            </div>
        `;
    }

    static renderCustomersTab() {
        return `
            <div id="customersTab" class="tab-content hidden">
                <div class="card">
                    <div class="card-header">
                        <span>Customer Management</span>
                        <div style="display: flex; gap: 10px;">
                            <input type="text" class="form-control" placeholder="Search customers..." style="width: 200px;" onchange="Customers.load(this.value)">
                            <button class="btn btn-primary" onclick="Modal.open('addCustomerModal')">+ Add Customer</button>
                        </div>
                    </div>
                    <div id="customersManagementTable"></div>
                </div>
            </div>
        `;
    }

    static renderReportsTab() {
        return `
            <div id="reportsTab" class="tab-content hidden">
                <div class="stats-grid" id="dashboardStats"></div>
                
                <div class="card">
                    <div class="card-header">Reports</div>
                    <div class="form-group">
                        <label class="form-label">Report Type</label>
                        <select class="form-control" id="reportType">
                            <option value="">Select Report Type</option>
                            <option value="daily">Daily Sales Report</option>
                            <option value="monthly">Monthly Sales Report</option>
                            <option value="yearly">Yearly Sales Report</option>
                            <option value="inventory">Inventory Report</option>
                            <option value="products">Product Performance</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Date Range</label>
                        <input type="date" class="form-control" id="reportStartDate">
                        <input type="date" class="form-control" id="reportEndDate" style="margin-top: 10px;">
                    </div>
                    <div style="margin-top: 15px;">
                        <button class="btn btn-primary" onclick="Reports.generate()">Generate Report</button>
                        <button class="btn btn-secondary" onclick="Reports.downloadPDF()" id="btnDownloadPdf" style="display: none;">📥 Download PDF</button>
                    </div>
                    <div id="reportContent" style="margin-top: 20px;"></div>
                </div>
            </div>
        `;
    }

    static renderSalesTab() {
        return `
            <div id="salesTab" class="tab-content hidden">
                <div class="card">
                    <div class="card-header">
                        <span>Sales History</span>
                        <div style="display: flex; gap: 10px;">
                            <input type="text" class="form-control" placeholder="Search invoice or customer..." style="width: 250px;" onchange="Sales.loadHistory(this.value)">
                        </div>
                    </div>
                    <div id="salesTable"></div>
                </div>
            </div>
        `;
    }

    static renderModals() {
        return `
            <!-- Import Product Modal -->
            <div class="modal" id="importProductModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Import Products (CSV)</h3>
                        <button class="close-btn" onclick="Modal.close('importProductModal')">×</button>
                    </div>
                    <form onsubmit="Forms.handleImportProducts(event)">
                        <div class="form-group">
                            <label class="form-label">Select CSV File</label>
                            <input type="file" class="form-control" id="importFile" accept=".csv" required>
                            <small style="color: var(--text-light)">Format: Name, SKU, Category, Price, Cost, Quantity, Reorder Level, Unit</small>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block">Upload & Import</button>
                    </form>
                </div>
            </div>

            <!-- Add Product Modal -->
            <div class="modal" id="addProductModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Add Product</h3>
                        <button class="close-btn" onclick="Modal.close('addProductModal')">×</button>
                    </div>
                    <form onsubmit="Forms.handleAddProduct(event)">
                        <div class="form-group">
                            <label class="form-label">Name *</label>
                            <input type="text" class="form-control" id="productName" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">SKU *</label>
                            <input type="text" class="form-control" id="productSku" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Category</label>
                            <input type="text" class="form-control" id="productCategory">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Description</label>
                            <textarea class="form-control" id="productDescription"></textarea>
                        </div>
                        <div class="row">
                            <div class="col-4 form-group">
                                <label class="form-label">Price *</label>
                                <input type="number" class="form-control" id="productPrice" step="0.01" required>
                            </div>
                            <div class="col-4 form-group">
                                <label class="form-label">Wholesale</label>
                                <input type="number" class="form-control" id="productWholesalePrice" step="0.01">
                            </div>
                            <div class="col-4 form-group">
                                <label class="form-label">Cost</label>
                                <input type="number" class="form-control" id="productCost" step="0.01">
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-4 form-group">
                                <label class="form-label">Quantity</label>
                                <input type="number" class="form-control" id="productQuantity" value="0">
                            </div>
                            <div class="col-4 form-group">
                                <label class="form-label">Reorder Level</label>
                                <input type="number" class="form-control" id="productReorder" value="10">
                            </div>
                            <div class="col-4 form-group">
                                <label class="form-label">Unit</label>
                                <input type="text" class="form-control" id="productUnit" value="pcs">
                            </div>
                        </div>
                        <button type="submit" class="btn btn-success btn-block">Add Product</button>
                    </form>
                </div>
            </div>

            <!-- Edit Product Modal -->
            <div class="modal" id="editProductModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Edit Product</h3>
                        <button class="close-btn" onclick="Modal.close('editProductModal')">×</button>
                    </div>
                    <form onsubmit="Forms.handleEditProduct(event)">
                        <input type="hidden" id="editProductId">
                        <div class="form-group">
                            <label class="form-label">Name *</label>
                            <input type="text" class="form-control" id="editProductName" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">SKU *</label>
                            <input type="text" class="form-control" id="editProductSku" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Category</label>
                            <input type="text" class="form-control" id="editProductCategory">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Description</label>
                            <textarea class="form-control" id="editProductDescription"></textarea>
                        </div>
                        <div class="row">
                            <div class="col-4 form-group">
                                <label class="form-label">Price *</label>
                                <input type="number" class="form-control" id="editProductPrice" step="0.01" required>
                            </div>
                            <div class="col-4 form-group">
                                <label class="form-label">Wholesale</label>
                                <input type="number" class="form-control" id="editProductWholesalePrice" step="0.01">
                            </div>
                            <div class="col-4 form-group">
                                <label class="form-label">Cost</label>
                                <input type="number" class="form-control" id="editProductCost" step="0.01">
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-6 form-group">
                                <label class="form-label">Reorder Level</label>
                                <input type="number" class="form-control" id="editProductReorder">
                            </div>
                            <div class="col-6 form-group">
                                <label class="form-label">Unit</label>
                                <input type="text" class="form-control" id="editProductUnit">
                            </div>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block">Update Product</button>
                    </form>
                </div>
            </div>

            <!-- Stock Management Modal -->
            <div class="modal" id="stockModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Manage Stock</h3>
                        <button class="close-btn" onclick="Modal.close('stockModal')">×</button>
                    </div>
                    <div style="margin-bottom: 20px; padding: 10px; background: rgba(99, 102, 241, 0.1); border-radius: 8px;">
                        <h4 id="stockProductName" style="margin: 0 0 5px 0;"></h4>
                        <div style="display: flex; justify-content: space-between;">
                            <p style="margin: 0; color: var(--text-light);">Current: <strong id="stockCurrentQuantity" style="color: var(--text);"></strong></p>
                            <p style="margin: 0; color: var(--text-light);">New: <strong id="stockNewQuantity" style="color: var(--primary);"></strong></p>
                        </div>
                    </div>
                    <form onsubmit="Forms.handleStockAdjustment(event)">
                        <input type="hidden" id="stockProductId">
                        <div class="form-group">
                            <label class="form-label">Action</label>
                            <select class="form-control" id="stockType" required onchange="Products.handleStockTypeChange()">
                                <option value="in">📥 Add Stock (Restock)</option>
                                <option value="out">📤 Remove Stock (Damage/Loss)</option>
                                <option value="adjustment">🔄 Set Exact Quantity (Correction)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Quantity *</label>
                            <input type="number" class="form-control" id="stockQuantity" min="0" required oninput="Products.updateStockPreview()">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Notes</label>
                            <textarea class="form-control" id="stockNotes" placeholder="Reason for adjustment..."></textarea>
                        </div>
                        <button type="submit" class="btn btn-success btn-block">Update Stock</button>
                    </form>
                </div>
            </div>

            <!-- Customer Modal -->
            <div class="modal" id="customerModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Select Customer</h3>
                        <button class="close-btn" onclick="Modal.close('customerModal')">×</button>
                    </div>
                    <div id="customerModalList"></div>
                    <button class="btn btn-primary btn-block" onclick="Modal.open('addCustomerModal')">+ Add New Customer</button>
                </div>
            </div>

            <!-- Add Customer Modal -->
            <div class="modal" id="addCustomerModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Add Customer</h3>
                        <button class="close-btn" onclick="Modal.close('addCustomerModal')">×</button>
                    </div>
                    <form onsubmit="Forms.handleAddCustomer(event)">
                        <div class="form-group">
                            <label class="form-label">Name *</label>
                            <input type="text" class="form-control" id="customerName" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Phone</label>
                            <input type="tel" class="form-control" id="customerPhone">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Email</label>
                            <input type="email" class="form-control" id="customerEmail">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Company</label>
                            <input type="text" class="form-control" id="customerCompany">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Address</label>
                            <textarea class="form-control" id="customerAddress"></textarea>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Credit Limit</label>
                            <input type="number" class="form-control" id="customerCredit" value="0" step="0.01">
                        </div>
                        <button type="submit" class="btn btn-success btn-block">Add Customer</button>
                    </form>
                </div>
            </div>

            <!-- Payment Modal -->
            <div class="modal" id="paymentModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Complete Payment</h3>
                        <button class="close-btn" onclick="Modal.close('paymentModal')">×</button>
                    </div>
                    
                    <div class="summary-row total" style="margin-bottom: 20px;">
                        <span>Total Amount:</span>
                        <span id="paymentTotal">KSh 0.00</span>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Payment Method *</label>
                        <div class="payment-grid">
                            <div class="payment-option" onclick="Sales.selectPaymentMethod('cash', event)">
                                💵 Cash
                            </div>
                            <div class="payment-option" onclick="Sales.selectPaymentMethod('mpesa', event)">
                                📱 M-Pesa
                            </div>
                            <div class="payment-option" onclick="Sales.selectPaymentMethod('card', event)">
                                💳 Card
                            </div>
                            <div class="payment-option" onclick="Sales.selectPaymentMethod('credit', event)">
                                📝 Credit
                            </div>
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Discount (KSh)</label>
                        <input type="number" class="form-control" id="paymentDiscount" value="0" min="0" step="0.01" oninput="Sales.updatePaymentTotal()">
                    </div>

                    <div class="form-group">
                        <label class="form-label">Notes</label>
                        <textarea class="form-control" id="paymentNotes"></textarea>
                    </div>

                    <button class="btn btn-success btn-block" onclick="Sales.complete()" id="completeSaleBtn">
                        Complete Sale
                    </button>
                </div>
            </div>

            <!-- Sale Complete Modal -->
            <div class="modal" id="saleCompleteModal">
                <div class="modal-content" style="text-align: center; max-width: 400px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">🎉</div>
                    <h3>Sale Completed!</h3>
                    <p id="completedSaleInfo" style="margin-bottom: 20px; font-size: 1.1em;"></p>
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button class="btn btn-primary" id="btnLastReceipt">🖨️ Print Receipt</button>
                        <button class="btn btn-success" onclick="Modal.close('saleCompleteModal')">New Sale</button>
                    </div>
                </div>
            </div>
        `;
    }

    static async loadInitialData() {
        try {
            await Promise.all([
                Products.load(),
                Customers.load()
            ]);
        } catch (error) {
            UI.showAlert('Failed to load initial data', 'danger');
        }
    }

    static setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                Modal.closeAll();
            }
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
    }

    static setDefaultDates() {
        const today = new Date().toISOString().split('T')[0];
        const startDate = document.getElementById('reportStartDate');
        const endDate = document.getElementById('reportEndDate');
        
        if (startDate) startDate.value = today;
        if (endDate) endDate.value = today;
    }
}

// ==================== INITIALIZE ====================

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Export for window access
window.Auth = Auth;
window.Products = Products;
window.Customers = Customers;
window.Cart = Cart;
window.Sales = Sales;
window.Reports = Reports;
window.Modal = Modal;
window.Tabs = Tabs;
window.Forms = Forms;
window.customerSelector = customerSelector;