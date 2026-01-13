# app_secure.py - PRODUCTION READY VERSION
from flask import Flask, jsonify, request, send_from_directory, make_response, send_file
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import jwt
import os
from decimal import Decimal, InvalidOperation
import secrets
from functools import wraps
import logging
from logging.handlers import RotatingFileHandler
import re
import csv
import io
from dotenv import load_dotenv

# ReportLab imports for PDF generation
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet

# Load environment variables
load_dotenv()

# Get the absolute path of the current directory to ensure the DB file is found correctly
basedir = os.path.abspath(os.path.dirname(__file__))

# ==================== CONFIGURATION ====================

class Config:
    FLASK_ENV = os.environ.get('FLASK_ENV', 'development')
    # Set a default secret key to fix the warning and keep sessions valid during dev
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev_secret_key_change_this_in_prod')

    # Updated database filename to create a fresh DB with the new 'barcode' column
    DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///' + os.path.join(basedir, 'pos_secure.db'))
    # Fix Heroku/Render postgres URL
    if DATABASE_URL and DATABASE_URL.startswith('postgres://'):
        DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
    
    SQLALCHEMY_DATABASE_URI = DATABASE_URL
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024
    JWT_ALGORITHM = 'HS256'
    JWT_EXPIRATION_HOURS = 8

app = Flask(__name__, static_folder='.', static_url_path='')
app.config.from_object(Config)

# Initialize extensions
db = SQLAlchemy(app)

# Configure CORS
CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "PUT", "DELETE"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

# ==================== LOGGING ====================

def setup_logging():
    if not os.path.exists('logs'):
        os.makedirs('logs')
    
    file_handler = RotatingFileHandler('logs/pos_system.log', maxBytes=1024000, backupCount=10)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    ))
    file_handler.setLevel(logging.INFO)
    app.logger.addHandler(file_handler)
    app.logger.setLevel(logging.INFO)

setup_logging()

# ==================== MODELS ====================

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default='cashier')
    is_active = db.Column(db.Boolean, default=True)
    last_login = db.Column(db.DateTime, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256')
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'role': self.role,
            'is_active': self.is_active,
            'last_login': self.last_login.isoformat() if self.last_login else None
        }

class Customer(db.Model):
    __tablename__ = 'customers'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, index=True)
    phone = db.Column(db.String(20), index=True)
    email = db.Column(db.String(100), index=True)
    address = db.Column(db.Text)
    company = db.Column(db.String(100))
    credit_limit = db.Column(db.Numeric(10, 2), default=0)
    current_balance = db.Column(db.Numeric(10, 2), default=0)
    loyalty_points = db.Column(db.Integer, default=0)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    sales = db.relationship('Sale', backref='customer', lazy=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'phone': self.phone,
            'email': self.email,
            'company': self.company,
            'credit_limit': float(self.credit_limit),
            'current_balance': float(self.current_balance),
            'loyalty_points': self.loyalty_points,
            'is_active': self.is_active
        }

class Product(db.Model):
    __tablename__ = 'products'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False, index=True)
    sku = db.Column(db.String(50), unique=True, nullable=False, index=True)
    barcode = db.Column(db.String(50), unique=True, index=True)
    category = db.Column(db.String(100), index=True)
    description = db.Column(db.Text)
    price = db.Column(db.Numeric(10, 2), nullable=False)
    wholesale_price = db.Column(db.Numeric(10, 2), default=0)
    cost = db.Column(db.Numeric(10, 2), default=0)
    quantity = db.Column(db.Integer, default=0)
    reorder_level = db.Column(db.Integer, default=10)
    unit = db.Column(db.String(20), default='pcs')
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    sale_items = db.relationship('SaleItem', backref='product', lazy=True)
    stock_movements = db.relationship('StockMovement', backref='product', lazy=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'sku': self.sku,
            'barcode': self.barcode,
            'category': self.category,
            'description': self.description,
            'price': float(self.price),
            'wholesale_price': float(self.wholesale_price) if self.wholesale_price else float(self.price),
            'cost': float(self.cost),
            'quantity': self.quantity,
            'reorder_level': self.reorder_level,
            'unit': self.unit,
            'low_stock': self.quantity <= self.reorder_level,
            'is_active': self.is_active
        }

class Sale(db.Model):
    __tablename__ = 'sales'
    id = db.Column(db.Integer, primary_key=True)
    invoice_number = db.Column(db.String(50), unique=True, nullable=False, index=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('customers.id'), index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), index=True)
    subtotal = db.Column(db.Numeric(10, 2), nullable=False)
    tax = db.Column(db.Numeric(10, 2), default=0)
    discount = db.Column(db.Numeric(10, 2), default=0)
    total = db.Column(db.Numeric(10, 2), nullable=False)
    payment_method = db.Column(db.String(20), nullable=False)
    payment_status = db.Column(db.String(20), default='paid')
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    
    items = db.relationship('SaleItem', backref='sale', lazy=True, cascade='all, delete-orphan')
    payments = db.relationship('Payment', backref='sale', lazy=True, cascade='all, delete-orphan')
    
    @staticmethod
    def generate_invoice_number():
        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        random_string = secrets.token_hex(3)
        return f"INV-{timestamp}-{random_string.upper()}"
    
    def to_dict(self):
        return {
            'id': self.id,
            'invoice_number': self.invoice_number,
            'customer_id': self.customer_id,
            'subtotal': float(self.subtotal),
            'tax': float(self.tax),
            'discount': float(self.discount),
            'total': float(self.total),
            'payment_method': self.payment_method,
            'payment_status': self.payment_status,
            'created_at': self.created_at.isoformat()
        }

class SaleItem(db.Model):
    __tablename__ = 'sale_items'
    id = db.Column(db.Integer, primary_key=True)
    sale_id = db.Column(db.Integer, db.ForeignKey('sales.id'), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False, index=True)
    quantity = db.Column(db.Integer, nullable=False)
    unit_price = db.Column(db.Numeric(10, 2), nullable=False)
    subtotal = db.Column(db.Numeric(10, 2), nullable=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'quantity': self.quantity,
            'unit_price': float(self.unit_price),
            'subtotal': float(self.subtotal)
        }

class Payment(db.Model):
    __tablename__ = 'payments'
    id = db.Column(db.Integer, primary_key=True)
    sale_id = db.Column(db.Integer, db.ForeignKey('sales.id'), nullable=False, index=True)
    payment_method = db.Column(db.String(20), nullable=False)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    reference = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class StockMovement(db.Model):
    __tablename__ = 'stock_movements'
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False, index=True)
    quantity = db.Column(db.Integer, nullable=False)
    movement_type = db.Column(db.String(20), nullable=False)
    reference = db.Column(db.String(100))
    notes = db.Column(db.Text)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class AuditLog(db.Model):
    __tablename__ = 'audit_logs'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), index=True)
    action = db.Column(db.String(50), nullable=False, index=True)
    entity_type = db.Column(db.String(50), nullable=False)
    entity_id = db.Column(db.Integer)
    details = db.Column(db.Text)
    ip_address = db.Column(db.String(50))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class Shift(db.Model):
    __tablename__ = 'shifts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    opening_cash = db.Column(db.Numeric(10, 2), nullable=False)
    closing_cash = db.Column(db.Numeric(10, 2))
    expected_cash = db.Column(db.Numeric(10, 2))
    cash_difference = db.Column(db.Numeric(10, 2))
    total_sales = db.Column(db.Numeric(10, 2), default=0)
    total_returns = db.Column(db.Numeric(10, 2), default=0)
    notes = db.Column(db.Text)
    status = db.Column(db.String(20), default='open')
    opened_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    closed_at = db.Column(db.DateTime)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'opening_cash': float(self.opening_cash),
            'closing_cash': float(self.closing_cash) if self.closing_cash else None,
            'expected_cash': float(self.expected_cash) if self.expected_cash else None,
            'cash_difference': float(self.cash_difference) if self.cash_difference else None,
            'total_sales': float(self.total_sales),
            'total_returns': float(self.total_returns),
            'status': self.status,
            'opened_at': self.opened_at.isoformat(),
            'closed_at': self.closed_at.isoformat() if self.closed_at else None
        }

class Return(db.Model):
    __tablename__ = 'returns'
    id = db.Column(db.Integer, primary_key=True)
    sale_id = db.Column(db.Integer, db.ForeignKey('sales.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    return_number = db.Column(db.String(50), unique=True, nullable=False, index=True)
    subtotal = db.Column(db.Numeric(10, 2), nullable=False)
    tax = db.Column(db.Numeric(10, 2), default=0)
    total = db.Column(db.Numeric(10, 2), nullable=False)
    refund_method = db.Column(db.String(20), nullable=False)
    reason = db.Column(db.Text)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    items = db.relationship('ReturnItem', backref='return_ref', lazy=True, cascade='all, delete-orphan')

    @staticmethod
    def generate_return_number():
        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        random_string = secrets.token_hex(3)
        return f"RET-{timestamp}-{random_string.upper()}"

    def to_dict(self):
        return {
            'id': self.id,
            'sale_id': self.sale_id,
            'return_number': self.return_number,
            'subtotal': float(self.subtotal),
            'tax': float(self.tax),
            'total': float(self.total),
            'refund_method': self.refund_method,
            'reason': self.reason,
            'created_at': self.created_at.isoformat()
        }

class ReturnItem(db.Model):
    __tablename__ = 'return_items'
    id = db.Column(db.Integer, primary_key=True)
    return_id = db.Column(db.Integer, db.ForeignKey('returns.id'), nullable=False, index=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False, index=True)
    quantity = db.Column(db.Integer, nullable=False)
    unit_price = db.Column(db.Numeric(10, 2), nullable=False)
    subtotal = db.Column(db.Numeric(10, 2), nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'quantity': self.quantity,
            'unit_price': float(self.unit_price),
            'subtotal': float(self.subtotal)
        }

# ==================== AUTHENTICATION ====================

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return jsonify({'error': 'Authentication required'}), 401
        
        try:
            if token.startswith('Bearer '):
                token = token[7:]
            
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=[app.config['JWT_ALGORITHM']])
            current_user = User.query.filter_by(id=data['user_id'], is_active=True).first()
            
            if not current_user:
                return jsonify({'error': 'User not found'}), 401
            
            current_user.last_login = datetime.utcnow()
            db.session.commit()
            
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        except Exception as e:
            app.logger.error(f'Token error: {str(e)}')
            return jsonify({'error': 'Authentication failed'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

def log_audit(user_id, action, entity_type, entity_id=None, details=None):
    """Helper function to log audit trails"""
    try:
        audit = AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
            ip_address=request.remote_addr
        )
        db.session.add(audit)
        db.session.commit()
    except Exception as e:
        app.logger.error(f'Audit log error: {str(e)}')

# ==================== ROUTES ====================

@app.route('/')
def serve_frontend():
    return send_from_directory('.', 'app.html')

@app.route('/<path:path>')
def serve_static(path):
    if path.endswith(('.py', '.db', '.env', '.git')) or '..' in path:
        return jsonify({'error': 'Access denied'}), 403
    return send_from_directory('.', path)

@app.route('/api/health')
def health():
    try:
        db.session.execute('SELECT 1')
        return jsonify({'status': 'healthy', 'database': 'connected'})
    except Exception as e:
        return jsonify({'status': 'unhealthy', 'error': str(e)}), 503

@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or not data.get('username') or not data.get('password'):
            return jsonify({'error': 'Username and password required'}), 400
        
        user = User.query.filter_by(username=data['username'], is_active=True).first()
        
        if not user or not user.check_password(data['password']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = jwt.encode({
            'user_id': user.id,
            'exp': datetime.utcnow() + timedelta(hours=app.config['JWT_EXPIRATION_HOURS'])
        }, app.config['SECRET_KEY'], algorithm=app.config['JWT_ALGORITHM'])
        
        return jsonify({'token': token, 'user': user.to_dict()})
    
    except Exception as e:
        app.logger.error(f'Login error: {str(e)}')
        return jsonify({'error': 'Login failed'}), 500

@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or not data.get('username') or not data.get('password'):
            return jsonify({'error': 'Username and password required'}), 400
        
        if User.query.filter_by(username=data['username']).first():
            return jsonify({'error': 'Username already exists'}), 409
        
        user = User(
            username=data['username'],
            role=data.get('role', 'cashier')
        )
        user.set_password(data['password'])
        
        db.session.add(user)
        db.session.commit()
        
        token = jwt.encode({
            'user_id': user.id,
            'exp': datetime.utcnow() + timedelta(hours=app.config['JWT_EXPIRATION_HOURS'])
        }, app.config['SECRET_KEY'], algorithm=app.config['JWT_ALGORITHM'])
        
        return jsonify({'token': token, 'user': user.to_dict()}), 201
    
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Register error: {str(e)}')
        return jsonify({'error': 'Registration failed'}), 500

# Customer routes
@app.route('/api/customers', methods=['GET', 'POST'])
@token_required
def handle_customers(current_user):
    if request.method == 'GET':
        try:
            search = request.args.get('search', '')
            page = int(request.args.get('page', 1))
            per_page = min(int(request.args.get('per_page', 20)), 100)
            
            query = Customer.query.filter_by(is_active=True)
            
            if search:
                query = query.filter(
                    db.or_(
                        Customer.name.ilike(f'%{search}%'),
                        Customer.phone.ilike(f'%{search}%'),
                        Customer.company.ilike(f'%{search}%')
                    )
                )
            
            customers = query.paginate(page=page, per_page=per_page, error_out=False)
            
            return jsonify({
                'customers': [c.to_dict() for c in customers.items],
                'total': customers.total,
                'pages': customers.pages
            })
        
        except Exception as e:
            app.logger.error(f'Get customers error: {str(e)}')
            return jsonify({'error': 'Failed to fetch customers'}), 500
    
    elif request.method == 'POST':
        try:
            data = request.get_json()
            
            if not data or not data.get('name'):
                return jsonify({'error': 'Customer name required'}), 400
            
            customer = Customer(
                name=data['name'],
                phone=data.get('phone'),
                email=data.get('email'),
                address=data.get('address'),
                company=data.get('company'),
                credit_limit=data.get('credit_limit', 0)
            )
            
            db.session.add(customer)
            db.session.commit()
            
            return jsonify({'message': 'Customer created', 'customer': customer.to_dict()}), 201
        
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Create customer error: {str(e)}')
            return jsonify({'error': 'Customer creation failed'}), 500

@app.route('/api/customers/<int:customer_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_customer(current_user, customer_id):
    customer = Customer.query.get_or_404(customer_id)
    
    if request.method == 'PUT':
        try:
            data = request.get_json()
            if 'name' in data: customer.name = data['name']
            if 'phone' in data: customer.phone = data['phone']
            if 'email' in data: customer.email = data['email']
            if 'address' in data: customer.address = data['address']
            if 'company' in data: customer.company = data['company']
            if 'credit_limit' in data: customer.credit_limit = data['credit_limit']
            
            db.session.commit()
            return jsonify({'message': 'Customer updated', 'customer': customer.to_dict()})
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Update customer error: {str(e)}')
            return jsonify({'error': 'Customer update failed'}), 500

    elif request.method == 'DELETE':
        try:
            customer.is_active = False
            db.session.commit()
            return jsonify({'message': 'Customer deleted'})
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Delete customer error: {str(e)}')
            return jsonify({'error': 'Customer deletion failed'}), 500

# Product routes
@app.route('/api/products', methods=['GET', 'POST'])
@token_required
def handle_products(current_user):
    if request.method == 'GET':
        try:
            search = request.args.get('search', '')
            category = request.args.get('category', '')
            low_stock = request.args.get('low_stock', '').lower() == 'true'
            page = int(request.args.get('page', 1))
            per_page = min(int(request.args.get('per_page', 20)), 100)
            
            query = Product.query.filter_by(is_active=True)
            
            if search:
                query = query.filter(
                    db.or_(
                        Product.name.ilike(f'%{search}%'),
                        Product.sku.ilike(f'%{search}%')
                    )
                )
            
            if category:
                query = query.filter_by(category=category)
            
            if low_stock:
                query = query.filter(Product.quantity <= Product.reorder_level)
            
            products = query.order_by(Product.name).paginate(page=page, per_page=per_page, error_out=False)
            
            return jsonify({
                'products': [p.to_dict() for p in products.items],
                'total': products.total,
                'pages': products.pages
            })
        
        except Exception as e:
            app.logger.error(f'Get products error: {str(e)}')
            return jsonify({'error': 'Failed to fetch products'}), 500
    
    elif request.method == 'POST':
        try:
            data = request.get_json()
            
            if not data or not data.get('name') or not data.get('sku') or not data.get('price'):
                return jsonify({'error': 'Name, SKU, and price required'}), 400
            
            if Product.query.filter_by(sku=data['sku']).first():
                return jsonify({'error': 'SKU already exists'}), 409
            
            product = Product(
                name=data['name'],
                sku=data['sku'],
                barcode=data.get('barcode'),
                category=data.get('category'),
                description=data.get('description'),
                price=Decimal(str(data['price'])),
                wholesale_price=Decimal(str(data.get('wholesale_price', 0))),
                cost=Decimal(str(data.get('cost', 0))),
                quantity=data.get('quantity', 0),
                reorder_level=data.get('reorder_level', 10),
                unit=data.get('unit', 'pcs')
            )
            
            db.session.add(product)
            db.session.commit()
            
            if data.get('quantity', 0) > 0:
                movement = StockMovement(
                    product_id=product.id,
                    quantity=data['quantity'],
                    movement_type='in',
                    reference='Initial stock',
                    user_id=current_user.id
                )
                db.session.add(movement)
                db.session.commit()
            
            return jsonify({'message': 'Product created', 'product': product.to_dict()}), 201
        
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Create product error: {str(e)}')
            return jsonify({'error': 'Product creation failed'}), 500

@app.route('/api/products/<int:product_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_product(current_user, product_id):
    product = Product.query.get_or_404(product_id)
    
    if request.method == 'PUT':
        try:
            data = request.get_json()
            
            if 'name' in data: product.name = data['name']
            if 'sku' in data:
                # Check uniqueness if changed
                if data['sku'] != product.sku and Product.query.filter_by(sku=data['sku']).first():
                    return jsonify({'error': 'SKU already exists'}), 409
                product.sku = data['sku']
            if 'category' in data: product.category = data['category']
            if 'description' in data: product.description = data['description']
            if 'price' in data: product.price = Decimal(str(data['price']))
            if 'wholesale_price' in data: product.wholesale_price = Decimal(str(data['wholesale_price']))
            if 'cost' in data: product.cost = Decimal(str(data.get('cost', 0)))
            if 'reorder_level' in data: product.reorder_level = int(data['reorder_level'])
            if 'unit' in data: product.unit = data['unit']
            
            db.session.commit()
            return jsonify({'message': 'Product updated', 'product': product.to_dict()})
            
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Update product error: {str(e)}')
            return jsonify({'error': 'Product update failed'}), 500

    elif request.method == 'DELETE':
        try:
            product.is_active = False
            db.session.commit()
            return jsonify({'message': 'Product deleted'})
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Delete product error: {str(e)}')
            return jsonify({'error': 'Product deletion failed'}), 500

@app.route('/api/import/products', methods=['POST'])
@token_required
def import_products(current_user):
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and file.filename.endswith('.csv'):
        try:
            # Use utf-8-sig to handle BOM from Excel
            stream = io.StringIO(file.stream.read().decode("utf-8-sig"), newline=None)
            csv_input = csv.DictReader(stream)
            
            # Normalize headers (strip whitespace)
            if csv_input.fieldnames:
                csv_input.fieldnames = [name.strip() for name in csv_input.fieldnames]
            
            added_count = 0
            errors = []
            
            for row in csv_input:
                try:
                    # Helper for case-insensitive key lookup
                    def get_val(keys, default=None):
                        for k in keys:
                            if k in row and row[k]:
                                return row[k]
                        return default

                    name = get_val(['Name', 'name', 'NAME'])
                    sku = get_val(['SKU', 'sku', 'Sku'])
                    price = get_val(['Price', 'price', 'PRICE'])

                    # Basic validation
                    if not name or not sku or not price:
                        continue
                        
                    # Check if exists
                    if Product.query.filter_by(sku=sku).first():
                        continue 
                    
                    product = Product(
                        name=name,
                        sku=sku,
                        category=get_val(['Category', 'category']),
                        price=Decimal(price),
                        cost=Decimal(get_val(['Cost', 'cost'], 0)),
                        quantity=int(get_val(['Quantity', 'quantity'], 0)),
                        reorder_level=int(get_val(['Reorder Level', 'reorder_level', 'Reorder'], 10)),
                        unit=get_val(['Unit', 'unit'], 'pcs')
                    )
                    db.session.add(product)
                    added_count += 1
                except Exception as e:
                    errors.append(f"Error row {row.get('SKU', row.get('sku', '?'))}: {str(e)}")
            
            db.session.commit()
            return jsonify({'message': f'Imported {added_count} products', 'errors': errors})
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Import error: {str(e)}')
            return jsonify({'error': f'Import failed: {str(e)}'}), 500
            
    return jsonify({'error': 'Invalid file format. Please upload CSV.'}), 400

@app.route('/api/export/products/pdf')
@token_required
def export_products_pdf(current_user):
    try:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        elements = []
        
        styles = getSampleStyleSheet()
        elements.append(Paragraph("Product Catalog", styles['Title']))
        elements.append(Spacer(1, 12))
        
        data = [['Name', 'SKU', 'Category', 'Price', 'Stock']]
        products = Product.query.filter_by(is_active=True).order_by(Product.name).all()
        
        for p in products:
            data.append([p.name[:30], p.sku, p.category or '', f"{p.price:.2f}", str(p.quantity)])
            
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ]))
        
        elements.append(table)
        doc.build(elements)
        
        buffer.seek(0)
        return send_file(buffer, as_attachment=True, download_name='products.pdf', mimetype='application/pdf')
    except Exception as e:
        app.logger.error(f"PDF Export error: {e}")
        return jsonify({'error': 'PDF generation failed'}), 500

# Sales routes
@app.route('/api/sales', methods=['GET', 'POST'])
@token_required
def handle_sales(current_user):
    if request.method == 'GET':
        try:
            search = request.args.get('search', '')
            page = int(request.args.get('page', 1))
            per_page = min(int(request.args.get('per_page', 20)), 100)
            
            query = Sale.query
            
            if search:
                query = query.outerjoin(Customer).filter(
                    db.or_(
                        Sale.invoice_number.ilike(f'%{search}%'),
                        Customer.name.ilike(f'%{search}%')
                    )
                )
            
            sales = query.order_by(Sale.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
            
            sales_data = []
            for sale in sales.items:
                sale_dict = sale.to_dict()
                sale_dict['customer_name'] = sale.customer.name if sale.customer else 'Walk-in'
                sale_dict['items_count'] = len(sale.items)
                sales_data.append(sale_dict)
            
            return jsonify({'sales': sales_data, 'total': sales.total, 'pages': sales.pages})
        
        except Exception as e:
            app.logger.error(f'Get sales error: {str(e)}')
            return jsonify({'error': 'Failed to fetch sales'}), 500
    
    elif request.method == 'POST':
        try:
            data = request.get_json()
            
            if not data or not data.get('items') or not data.get('payment_method'):
                return jsonify({'error': 'Items and payment method required'}), 400
            
            if data['payment_method'] == 'credit' and not data.get('customer_id'):
                return jsonify({'error': 'Customer is required for credit sales'}), 400

            if data.get('customer_id'):
                if not Customer.query.get(data['customer_id']):
                    return jsonify({'error': 'Invalid customer ID'}), 400
            
            invoice_number = Sale.generate_invoice_number()
            subtotal = Decimal('0')
            sale_items = []
            
            for item in data['items']:
                product = Product.query.filter_by(id=item['product_id'], is_active=True).first()
                if not product:
                    return jsonify({'error': f'Product not found: {item["product_id"]}'}), 404
                
                quantity = int(item['quantity'])
                if quantity <= 0:
                    return jsonify({'error': f'Invalid quantity for {product.name}'}), 400
                
                if product.quantity < quantity:
                    return jsonify({'error': f'Insufficient stock for {product.name}'}), 400
                
                unit_price = Decimal(str(item.get('unit_price', product.price)))
                item_subtotal = unit_price * quantity
                subtotal += item_subtotal
                
                sale_items.append({
                    'product': product,
                    'quantity': quantity,
                    'unit_price': unit_price,
                    'subtotal': item_subtotal
                })
            
            tax_rate = Decimal(str(data.get('tax_rate', 16)))
            tax = subtotal * tax_rate / Decimal('100')
            discount = Decimal(str(data.get('discount', 0)))
            if discount < 0:
                return jsonify({'error': 'Discount cannot be negative'}), 400
            
            total = max(Decimal('0'), subtotal + tax - discount)
            
            sale = Sale(
                invoice_number=invoice_number,
                customer_id=data.get('customer_id'),
                user_id=current_user.id,
                subtotal=subtotal,
                tax=tax,
                discount=discount,
                total=total,
                payment_method=data['payment_method'],
                payment_status=data.get('payment_status', 'paid'),
                notes=data.get('notes')
            )
            
            db.session.add(sale)
            db.session.flush()
            
            for item_data in sale_items:
                sale_item = SaleItem(
                    sale_id=sale.id,
                    product_id=item_data['product'].id,
                    quantity=item_data['quantity'],
                    unit_price=item_data['unit_price'],
                    subtotal=item_data['subtotal']
                )
                db.session.add(sale_item)
                
                item_data['product'].quantity -= item_data['quantity']
                
                movement = StockMovement(
                    product_id=item_data['product'].id,
                    quantity=item_data['quantity'],
                    movement_type='out',
                    reference=invoice_number,
                    user_id=current_user.id
                )
                db.session.add(movement)
            
            payment = Payment(
                sale_id=sale.id,
                payment_method=data['payment_method'],
                amount=total,
                reference=data.get('payment_reference')
            )
            db.session.add(payment)
            
            customer_obj = None
            if sale.customer_id:
                customer_obj = Customer.query.get(sale.customer_id)
                if customer_obj:
                    points = int(float(total) / 100)
                    customer_obj.loyalty_points += points
                    if sale.payment_method == 'credit':
                        customer_obj.current_balance += total
            
            db.session.commit()
            
            # Return full receipt data to avoid extra API call and fix printing
            receipt_data = {
                'id': sale.id,
                'invoice_number': sale.invoice_number,
                'date': sale.created_at.isoformat(),
                'customer': customer_obj.to_dict() if customer_obj else {'name': 'Walk-in Customer'},
                'items': [{
                    'product_name': item['product'].name,
                    'quantity': item['quantity'],
                    'unit_price': float(item['unit_price']),
                    'subtotal': float(item['subtotal'])
                } for item in sale_items],
                'subtotal': float(sale.subtotal),
                'tax': float(sale.tax),
                'discount': float(sale.discount),
                'total': float(sale.total),
                'payment_method': sale.payment_method,
                'cashier': current_user.username
            }

            return jsonify({
                'message': 'Sale completed',
                'sale': receipt_data
            }), 201
        
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Sale error: {str(e)}')
            return jsonify({'error': 'Sale processing failed'}), 500

@app.route('/api/sales/<int:sale_id>')
@token_required
def sale_detail(current_user, sale_id):
    try:
        sale = Sale.query.get_or_404(sale_id)
        sale_data = sale.to_dict()
        sale_data['customer'] = sale.customer.to_dict() if sale.customer else None
        sale_data['items'] = [{
            **item.to_dict(),
            'product_name': item.product.name,
            'product_sku': item.product.sku
        } for item in sale.items]
        return jsonify(sale_data)
    except Exception as e:
        app.logger.error(f'Sale detail error: {str(e)}')
        return jsonify({'error': 'Failed to fetch sale'}), 500

# Stock management
@app.route('/api/stock/movement', methods=['POST'])
@token_required
def stock_movement(current_user):
    try:
        data = request.get_json()
        
        if not data or not data.get('product_id') or not data.get('quantity') or not data.get('movement_type'):
            return jsonify({'error': 'Product ID, quantity, and type required'}), 400
        
        product = Product.query.filter_by(id=data['product_id'], is_active=True).first()
        if not product:
            return jsonify({'error': 'Product not found'}), 404
        
        quantity = int(data['quantity'])
        movement_type = data['movement_type']
        
        if movement_type == 'out' and product.quantity < quantity:
            return jsonify({'error': 'Insufficient stock'}), 400
        
        old_quantity = product.quantity
        if movement_type == 'in':
            product.quantity += quantity
        elif movement_type == 'out':
            product.quantity -= quantity
        elif movement_type == 'adjustment':
            product.quantity = quantity
        
        movement = StockMovement(
            product_id=product.id,
            quantity=quantity,
            movement_type=movement_type,
            reference=data.get('reference'),
            notes=data.get('notes'),
            user_id=current_user.id
        )
        
        db.session.add(movement)
        db.session.commit()
        
        return jsonify({
            'message': 'Stock updated',
            'product': product.to_dict(),
            'previous_quantity': old_quantity,
            'new_quantity': product.quantity
        })
    
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Stock movement error: {str(e)}')
        return jsonify({'error': 'Stock update failed'}), 500

@app.route('/api/stock/movements')
@token_required
def get_stock_movements(current_user):
    try:
        page = int(request.args.get('page', 1))
        per_page = min(int(request.args.get('per_page', 20)), 100)
        
        movements = StockMovement.query.order_by(StockMovement.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        movements_data = []
        for m in movements.items:
            movement_dict = {
                'id': m.id,
                'product_id': m.product_id,
                'product_name': m.product.name,
                'quantity': m.quantity,
                'movement_type': m.movement_type,
                'reference': m.reference,
                'created_at': m.created_at.isoformat(),
                'user_name': User.query.get(m.user_id).username if m.user_id else 'System'
            }
            movements_data.append(movement_dict)
        
        return jsonify({'movements': movements_data, 'total': movements.total})
    
    except Exception as e:
        app.logger.error(f'Get movements error: {str(e)}')
        return jsonify({'error': 'Failed to fetch movements'}), 500

# Reports
@app.route('/api/reports/sales')
@token_required
def sales_report(current_user):
    try:
        report_type = request.args.get('type', 'daily')
        date = request.args.get('date', datetime.utcnow().strftime('%Y-%m-%d'))
        
        if report_type == 'daily':
            start_date = datetime.strptime(date, '%Y-%m-%d')
            end_date = start_date + timedelta(days=1)
        elif report_type == 'monthly':
            # Expecting YYYY-MM-DD, we strip to YYYY-MM
            start_date = datetime.strptime(date[:7], '%Y-%m')
            # Calculate first day of next month
            if start_date.month == 12:
                end_date = start_date.replace(year=start_date.year + 1, month=1)
            else:
                end_date = start_date.replace(month=start_date.month + 1)
        elif report_type == 'yearly':
            # Expecting YYYY-MM-DD, we strip to YYYY
            start_date = datetime.strptime(date[:4], '%Y')
            end_date = start_date.replace(year=start_date.year + 1)
        else:
            return jsonify({'error': 'Invalid report type'}), 400
        
        sales = Sale.query.filter(Sale.created_at >= start_date, Sale.created_at < end_date).all()
        
        total_sales = sum(float(s.total) for s in sales)
        total_tax = sum(float(s.tax) for s in sales)
        total_discount = sum(float(s.discount) for s in sales)
        
        payment_breakdown = {}
        for sale in sales:
            method = sale.payment_method
            payment_breakdown[method] = payment_breakdown.get(method, 0) + float(sale.total)
        
        return jsonify({
            'period': report_type,
            'date': date,
            'total_sales': total_sales,
            'total_tax': total_tax,
            'total_discount': total_discount,
            'transactions_count': len(sales),
            'payment_breakdown': payment_breakdown
        })
    
    except Exception as e:
        app.logger.error(f'Daily report error: {str(e)}')
        return jsonify({'error': 'Report generation failed'}), 500

@app.route('/api/reports/sales/pdf')
@token_required
def export_sales_report_pdf(current_user):
    try:
        report_type = request.args.get('type', 'daily')
        date = request.args.get('date', datetime.utcnow().strftime('%Y-%m-%d'))
        
        if report_type == 'daily':
            start_date = datetime.strptime(date, '%Y-%m-%d')
            end_date = start_date + timedelta(days=1)
            title = f"Daily Sales Report - {date}"
        elif report_type == 'monthly':
            start_date = datetime.strptime(date[:7], '%Y-%m')
            if start_date.month == 12:
                end_date = start_date.replace(year=start_date.year + 1, month=1)
            else:
                end_date = start_date.replace(month=start_date.month + 1)
            title = f"Monthly Sales Report - {date[:7]}"
        elif report_type == 'yearly':
            start_date = datetime.strptime(date[:4], '%Y')
            end_date = start_date.replace(year=start_date.year + 1)
            title = f"Yearly Sales Report - {date[:4]}"
        else:
            return jsonify({'error': 'Invalid report type'}), 400

        sales = Sale.query.filter(Sale.created_at >= start_date, Sale.created_at < end_date).order_by(Sale.created_at).all()
        
        total_sales = sum(float(s.total) for s in sales)
        total_tax = sum(float(s.tax) for s in sales)
        transactions_count = len(sales)
        
        payment_breakdown = {}
        for sale in sales:
            method = sale.payment_method
            payment_breakdown[method] = payment_breakdown.get(method, 0) + float(sale.total)

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        elements = []
        styles = getSampleStyleSheet()
        
        elements.append(Paragraph(title, styles['Title']))
        elements.append(Spacer(1, 12))
        
        # Summary Table
        summary_data = [
            ['Total Sales', f"{total_sales:,.2f}"],
            ['Total Tax', f"{total_tax:,.2f}"],
            ['Transactions', str(transactions_count)]
        ]
        t_summary = Table(summary_data, colWidths=[200, 200])
        t_summary.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ]))
        elements.append(t_summary)
        elements.append(Spacer(1, 20))
        
        elements.append(Paragraph("Payment Breakdown", styles['Heading2']))
        payment_data = [['Method', 'Amount']] + [[k, f"{v:,.2f}"] for k, v in payment_breakdown.items()]
        t_payment = Table(payment_data, colWidths=[200, 200])
        t_payment.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ]))
        elements.append(t_payment)

        doc.build(elements)
        buffer.seek(0)
        return send_file(buffer, as_attachment=True, download_name=f'sales_report_{date}.pdf', mimetype='application/pdf')

    except Exception as e:
        app.logger.error(f"PDF Report error: {e}")
        return jsonify({'error': 'PDF generation failed'}), 500

@app.route('/api/reports/inventory')
@token_required
def inventory_report(current_user):
    try:
        products = Product.query.filter_by(is_active=True).all()
        
        total_value = sum(float(p.cost) * p.quantity for p in products)
        low_stock_items = [p for p in products if p.quantity <= p.reorder_level and p.quantity > 0]
        out_of_stock = [p for p in products if p.quantity == 0]
        
        return jsonify({
            'total_products': len(products),
            'total_value': total_value,
            'low_stock_count': len(low_stock_items),
            'out_of_stock_count': len(out_of_stock),
            'low_stock_items': [p.to_dict() for p in low_stock_items],
            'out_of_stock_items': [p.to_dict() for p in out_of_stock]
        })
    
    except Exception as e:
        app.logger.error(f'Inventory report error: {str(e)}')
        return jsonify({'error': 'Report generation failed'}), 500

@app.route('/api/reports/product-performance')
@token_required
def product_performance(current_user):
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        query = db.session.query(
            Product.id,
            Product.name,
            Product.sku,
            db.func.sum(SaleItem.quantity).label('total_sold'),
            db.func.sum(SaleItem.subtotal).label('total_revenue')
        ).join(SaleItem).join(Sale)
        
        if start_date:
            query = query.filter(Sale.created_at >= datetime.fromisoformat(start_date))
        if end_date:
            end = datetime.fromisoformat(end_date) + timedelta(days=1)
            query = query.filter(Sale.created_at < end)
        
        results = query.group_by(Product.id).order_by(db.desc('total_revenue')).all()
        
        return jsonify([{
            'product_id': r.id,
            'name': r.name,
            'sku': r.sku,
            'total_sold': r.total_sold or 0,
            'total_revenue': float(r.total_revenue or 0)
        } for r in results])
    
    except Exception as e:
        app.logger.error(f'Performance report error: {str(e)}')
        return jsonify({'error': 'Report generation failed'}), 500

# Dashboard
@app.route('/api/dashboard/stats')
@token_required
def dashboard_stats(current_user):
    try:
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        last_30_days = today - timedelta(days=30)
        
        today_sales = Sale.query.filter(Sale.created_at >= today).all()
        monthly_sales = Sale.query.filter(Sale.created_at >= last_30_days).all()
        
        return jsonify({
            'today_revenue': sum(float(s.total or 0) for s in today_sales),
            'today_transactions': len(today_sales),
            'monthly_revenue': sum(float(s.total or 0) for s in monthly_sales),
            'total_customers': Customer.query.filter_by(is_active=True).count(),
            'total_products': Product.query.filter_by(is_active=True).count(),
            'low_stock_alerts': Product.query.filter(
                Product.quantity <= Product.reorder_level,
                Product.is_active == True
            ).count()
        })
    
    except Exception as e:
        app.logger.error(f'Dashboard error: {str(e)}')
        return jsonify({'error': 'Failed to fetch stats'}), 500

# ==================== RETURNS & REFUNDS ====================

@app.route('/api/returns', methods=['GET', 'POST'])
@token_required
def handle_returns(current_user):
    if request.method == 'GET':
        try:
            page = int(request.args.get('page', 1))
            per_page = min(int(request.args.get('per_page', 20)), 100)

            returns = Return.query.order_by(Return.created_at.desc()).paginate(
                page=page, per_page=per_page, error_out=False
            )

            returns_data = []
            for ret in returns.items:
                ret_dict = ret.to_dict()
                sale = Sale.query.get(ret.sale_id)
                ret_dict['original_invoice'] = sale.invoice_number if sale else None
                ret_dict['items_count'] = len(ret.items)
                returns_data.append(ret_dict)

            return jsonify({'returns': returns_data, 'total': returns.total, 'pages': returns.pages})

        except Exception as e:
            app.logger.error(f'Get returns error: {str(e)}')
            return jsonify({'error': 'Failed to fetch returns'}), 500

    elif request.method == 'POST':
        try:
            data = request.get_json()

            if not data or not data.get('sale_id') or not data.get('items') or not data.get('refund_method'):
                return jsonify({'error': 'Sale ID, items, and refund method required'}), 400

            sale = Sale.query.get(data['sale_id'])
            if not sale:
                return jsonify({'error': 'Original sale not found'}), 404

            return_number = Return.generate_return_number()
            subtotal = Decimal('0')
            return_items = []

            for item in data['items']:
                product = Product.query.get(item['product_id'])
                if not product:
                    return jsonify({'error': f'Product not found: {item["product_id"]}'}), 404

                quantity = int(item['quantity'])
                unit_price = Decimal(str(item.get('unit_price', product.price)))
                item_subtotal = unit_price * quantity
                subtotal += item_subtotal

                return_items.append({
                    'product': product,
                    'quantity': quantity,
                    'unit_price': unit_price,
                    'subtotal': item_subtotal
                })

            tax_rate = Decimal(str(data.get('tax_rate', 16)))
            tax = subtotal * tax_rate / Decimal('100')
            total = subtotal + tax

            return_record = Return(
                sale_id=data['sale_id'],
                user_id=current_user.id,
                return_number=return_number,
                subtotal=subtotal,
                tax=tax,
                total=total,
                refund_method=data['refund_method'],
                reason=data.get('reason'),
                notes=data.get('notes')
            )

            db.session.add(return_record)
            db.session.flush()

            for item_data in return_items:
                return_item = ReturnItem(
                    return_id=return_record.id,
                    product_id=item_data['product'].id,
                    quantity=item_data['quantity'],
                    unit_price=item_data['unit_price'],
                    subtotal=item_data['subtotal']
                )
                db.session.add(return_item)

                item_data['product'].quantity += item_data['quantity']

                movement = StockMovement(
                    product_id=item_data['product'].id,
                    quantity=item_data['quantity'],
                    movement_type='in',
                    reference=return_number,
                    notes='Return',
                    user_id=current_user.id
                )
                db.session.add(movement)

            log_audit(current_user.id, 'create', 'return', return_record.id, f'Return {return_number}')
            db.session.commit()

            return jsonify({
                'message': 'Return processed successfully',
                'return': {
                    'id': return_record.id,
                    'return_number': return_record.return_number,
                    'total': float(return_record.total)
                }
            }), 201

        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Return error: {str(e)}')
            return jsonify({'error': 'Return processing failed'}), 500

# ==================== SHIFT MANAGEMENT ====================

@app.route('/api/shifts', methods=['GET', 'POST'])
@token_required
def handle_shifts(current_user):
    if request.method == 'GET':
        try:
            page = int(request.args.get('page', 1))
            per_page = min(int(request.args.get('per_page', 20)), 100)

            shifts = Shift.query.order_by(Shift.opened_at.desc()).paginate(
                page=page, per_page=per_page, error_out=False
            )

            shifts_data = []
            for shift in shifts.items:
                shift_dict = shift.to_dict()
                user = User.query.get(shift.user_id)
                shift_dict['user_name'] = user.username if user else 'Unknown'
                shifts_data.append(shift_dict)

            return jsonify({'shifts': shifts_data, 'total': shifts.total, 'pages': shifts.pages})

        except Exception as e:
            app.logger.error(f'Get shifts error: {str(e)}')
            return jsonify({'error': 'Failed to fetch shifts'}), 500

    elif request.method == 'POST':
        try:
            data = request.get_json()

            if not data or 'opening_cash' not in data:
                return jsonify({'error': 'Opening cash amount required'}), 400

            open_shift = Shift.query.filter_by(user_id=current_user.id, status='open').first()
            if open_shift:
                return jsonify({'error': 'You already have an open shift'}), 400

            shift = Shift(
                user_id=current_user.id,
                opening_cash=Decimal(str(data['opening_cash'])),
                notes=data.get('notes')
            )

            db.session.add(shift)
            log_audit(current_user.id, 'open_shift', 'shift', shift.id)
            db.session.commit()

            return jsonify({'message': 'Shift opened', 'shift': shift.to_dict()}), 201

        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Open shift error: {str(e)}')
            return jsonify({'error': 'Shift opening failed'}), 500

@app.route('/api/shifts/<int:shift_id>/close', methods=['POST'])
@token_required
def close_shift(current_user, shift_id):
    try:
        shift = Shift.query.get_or_404(shift_id)

        if shift.user_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403

        if shift.status == 'closed':
            return jsonify({'error': 'Shift already closed'}), 400

        data = request.get_json()
        if not data or 'closing_cash' not in data:
            return jsonify({'error': 'Closing cash amount required'}), 400

        shift.closing_cash = Decimal(str(data['closing_cash']))
        shift.expected_cash = Decimal(str(data.get('expected_cash', shift.opening_cash)))
        shift.cash_difference = shift.closing_cash - shift.expected_cash
        shift.notes = data.get('notes', shift.notes)
        shift.status = 'closed'
        shift.closed_at = datetime.utcnow()

        log_audit(current_user.id, 'close_shift', 'shift', shift.id)
        db.session.commit()

        return jsonify({'message': 'Shift closed', 'shift': shift.to_dict()})

    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Close shift error: {str(e)}')
        return jsonify({'error': 'Shift closing failed'}), 500

@app.route('/api/shifts/current')
@token_required
def get_current_shift(current_user):
    try:
        shift = Shift.query.filter_by(user_id=current_user.id, status='open').first()
        if not shift:
            return jsonify({'shift': None})
        return jsonify({'shift': shift.to_dict()})
    except Exception as e:
        app.logger.error(f'Get current shift error: {str(e)}')
        return jsonify({'error': 'Failed to fetch current shift'}), 500

# ==================== USER MANAGEMENT ====================

@app.route('/api/users', methods=['GET', 'POST'])
@token_required
def handle_users(current_user):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    if request.method == 'GET':
        try:
            users = User.query.all()
            return jsonify({'users': [u.to_dict() for u in users]})
        except Exception as e:
            app.logger.error(f'Get users error: {str(e)}')
            return jsonify({'error': 'Failed to fetch users'}), 500

    elif request.method == 'POST':
        try:
            data = request.get_json()

            if not data or not data.get('username') or not data.get('password'):
                return jsonify({'error': 'Username and password required'}), 400

            if User.query.filter_by(username=data['username']).first():
                return jsonify({'error': 'Username already exists'}), 409

            user = User(
                username=data['username'],
                role=data.get('role', 'cashier')
            )
            user.set_password(data['password'])

            db.session.add(user)
            log_audit(current_user.id, 'create', 'user', user.id, f'Created user {user.username}')
            db.session.commit()

            return jsonify({'message': 'User created', 'user': user.to_dict()}), 201

        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Create user error: {str(e)}')
            return jsonify({'error': 'User creation failed'}), 500

@app.route('/api/users/<int:user_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_user(current_user, user_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    user = User.query.get_or_404(user_id)

    if request.method == 'PUT':
        try:
            data = request.get_json()

            if data.get('password'):
                user.set_password(data['password'])
            if 'role' in data:
                user.role = data['role']
            if 'is_active' in data:
                user.is_active = data['is_active']

            log_audit(current_user.id, 'update', 'user', user.id, f'Updated user {user.username}')
            db.session.commit()

            return jsonify({'message': 'User updated', 'user': user.to_dict()})

        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Update user error: {str(e)}')
            return jsonify({'error': 'User update failed'}), 500

    elif request.method == 'DELETE':
        try:
            if user.id == current_user.id:
                return jsonify({'error': 'Cannot delete your own account'}), 400

            user.is_active = False
            log_audit(current_user.id, 'delete', 'user', user.id, f'Deactivated user {user.username}')
            db.session.commit()

            return jsonify({'message': 'User deactivated'})

        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Delete user error: {str(e)}')
            return jsonify({'error': 'User deletion failed'}), 500

# ==================== EXPORT DATA ====================

@app.route('/api/export/sales')
@token_required
def export_sales(current_user):
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')

        query = Sale.query

        if start_date:
            query = query.filter(Sale.created_at >= datetime.fromisoformat(start_date))
        if end_date:
            end = datetime.fromisoformat(end_date) + timedelta(days=1)
            query = query.filter(Sale.created_at < end)

        sales = query.order_by(Sale.created_at.desc()).all()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Invoice', 'Date', 'Customer', 'Subtotal', 'Tax', 'Discount', 'Total', 'Payment Method', 'Status'])

        for sale in sales:
            writer.writerow([
                sale.invoice_number,
                sale.created_at.strftime('%Y-%m-%d %H:%M'),
                sale.customer.name if sale.customer else 'Walk-in',
                float(sale.subtotal),
                float(sale.tax),
                float(sale.discount),
                float(sale.total),
                sale.payment_method,
                sale.payment_status
            ])

        output.seek(0)
        response = make_response(output.getvalue())
        response.headers['Content-Disposition'] = 'attachment; filename=sales_export.csv'
        response.headers['Content-Type'] = 'text/csv'

        log_audit(current_user.id, 'export', 'sales', None, 'Exported sales data')
        return response

    except Exception as e:
        app.logger.error(f'Export sales error: {str(e)}')
        return jsonify({'error': 'Export failed'}), 500

@app.route('/api/export/products')
@token_required
def export_products(current_user):
    try:
        products = Product.query.filter_by(is_active=True).all()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Name', 'SKU', 'Barcode', 'Category', 'Price', 'Cost', 'Quantity', 'Reorder Level', 'Unit'])

        for product in products:
            writer.writerow([
                product.name,
                product.sku,
                product.barcode or '',
                product.category or '',
                float(product.price),
                float(product.cost),
                product.quantity,
                product.reorder_level,
                product.unit
            ])

        output.seek(0)
        response = make_response(output.getvalue())
        response.headers['Content-Disposition'] = 'attachment; filename=products_export.csv'
        response.headers['Content-Type'] = 'text/csv'

        log_audit(current_user.id, 'export', 'products', None, 'Exported products data')
        return response

    except Exception as e:
        app.logger.error(f'Export products error: {str(e)}')
        return jsonify({'error': 'Export failed'}), 500

# ==================== AUDIT LOGS ====================

@app.route('/api/audit-logs')
@token_required
def get_audit_logs(current_user):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    try:
        page = int(request.args.get('page', 1))
        per_page = min(int(request.args.get('per_page', 50)), 200)

        logs = AuditLog.query.order_by(AuditLog.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )

        logs_data = []
        for log in logs.items:
            user = User.query.get(log.user_id)
            logs_data.append({
                'id': log.id,
                'user_name': user.username if user else 'Unknown',
                'action': log.action,
                'entity_type': log.entity_type,
                'entity_id': log.entity_id,
                'details': log.details,
                'ip_address': log.ip_address,
                'created_at': log.created_at.isoformat()
            })

        return jsonify({'logs': logs_data, 'total': logs.total, 'pages': logs.pages})

    except Exception as e:
        app.logger.error(f'Get audit logs error: {str(e)}')
        return jsonify({'error': 'Failed to fetch audit logs'}), 500

# ==================== RECEIPT PRINTING ====================

@app.route('/api/receipts/<string:invoice_number>')
@token_required
def get_receipt(current_user, invoice_number):
    try:
        sale = Sale.query.filter_by(invoice_number=invoice_number).first_or_404()

        receipt_data = {
            'invoice_number': sale.invoice_number,
            'date': sale.created_at.isoformat(),
            'customer': sale.customer.to_dict() if sale.customer else {'name': 'Walk-in Customer'},
            'items': [{
                'product_name': item.product.name,
                'quantity': item.quantity,
                'unit_price': float(item.unit_price),
                'subtotal': float(item.subtotal)
            } for item in sale.items],
            'subtotal': float(sale.subtotal),
            'tax': float(sale.tax),
            'discount': float(sale.discount),
            'total': float(sale.total),
            'payment_method': sale.payment_method,
            'cashier': User.query.get(sale.user_id).username if sale.user_id else 'Unknown'
        }

        return jsonify(receipt_data)

    except Exception as e:
        app.logger.error(f'Get receipt error: {str(e)}')
        return jsonify({'error': 'Failed to fetch receipt'}), 500

# ==================== BARCODE SEARCH ====================

@app.route('/api/products/barcode/<string:barcode>')
@token_required
def search_by_barcode(current_user, barcode):
    try:
        product = Product.query.filter_by(barcode=barcode, is_active=True).first()
        if not product:
            return jsonify({'error': 'Product not found'}), 404
        return jsonify({'product': product.to_dict()})
    except Exception as e:
        app.logger.error(f'Barcode search error: {str(e)}')
        return jsonify({'error': 'Search failed'}), 500

# ==================== CUSTOMER PAYMENT HISTORY ====================

@app.route('/api/customers/<int:customer_id>/payments')
@token_required
def get_customer_payments(current_user, customer_id):
    try:
        customer = Customer.query.get_or_404(customer_id)
        sales = Sale.query.filter_by(customer_id=customer_id).order_by(Sale.created_at.desc()).limit(50).all()

        payments = []
        for sale in sales:
            for payment in sale.payments:
                payments.append({
                    'id': payment.id,
                    'invoice_number': sale.invoice_number,
                    'amount': float(payment.amount),
                    'payment_method': payment.payment_method,
                    'reference': payment.reference,
                    'date': payment.created_at.isoformat()
                })

        return jsonify({
            'customer': customer.to_dict(),
            'payments': payments,
            'total_paid': sum(p['amount'] for p in payments)
        })

    except Exception as e:
        app.logger.error(f'Get customer payments error: {str(e)}')
        return jsonify({'error': 'Failed to fetch payments'}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    try:
        db.session.rollback()
    except Exception:
        pass
    return jsonify({'error': 'Internal server error'}), 500

# ==================== DATABASE INITIALIZATION ====================

def init_db():
    with app.app_context():
        db.create_all()
        
        if not User.query.filter_by(username='admin').first():
            admin = User(username='admin', role='admin')
            admin.set_password('Admin123!')
            db.session.add(admin)
            db.session.commit()
            app.logger.info("Admin user created")
        
        if Product.query.count() == 0:
            sample_products = [
                Product(name='Cardboard Box Small', sku='BOX-SM-001', category='Boxes', 
                       price=50.0, wholesale_price=45.0, cost=30.0, quantity=100, reorder_level=20),
                Product(name='Cardboard Box Medium', sku='BOX-MD-001', category='Boxes', 
                       price=75.0, wholesale_price=68.0, cost=45.0, quantity=50, reorder_level=15),
                Product(name='Cardboard Box Large', sku='BOX-LG-001', category='Boxes', 
                       price=100.0, wholesale_price=90.0, cost=60.0, quantity=25, reorder_level=10),
                Product(name='Bubble Wrap Roll', sku='BUBBLE-001', category='Wrapping', 
                       price=150.0, wholesale_price=135.0, cost=90.0, quantity=30, reorder_level=10),
                Product(name='Packaging Tape', sku='TAPE-001', category='Tapes', 
                       price=80.0, wholesale_price=70.0, cost=40.0, quantity=200, reorder_level=50),
            ]
            
            for product in sample_products:
                db.session.add(product)
            
            db.session.commit()
            app.logger.info("Sample products created")

# ==================== APPLICATION STARTUP ====================

# Initialize database when imported (ensures tables exist in production)
init_db()

if __name__ == '__main__':
    # The init_db() call is now handled at the module level to ensure it runs once on import.
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)