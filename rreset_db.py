import sqlite3
import os
from datetime import datetime
from app_secure import app, db, Product, User

# Configuration
DB_FILE = 'pos_secure.db'
BACKUP_FILE = 'pos_secure.db.bak'

def parse_date(date_str):
    """Helper to parse date strings from SQLite back to Python datetime objects"""
    if not date_str:
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(date_str)
    except ValueError:
        try:
            # Try parsing format like '2023-01-01 12:00:00.000000'
            return datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S.%f')
        except ValueError:
            try:
                # Try parsing format like '2023-01-01 12:00:00'
                return datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
            except:
                return datetime.utcnow()

def reset_database():
    print("--- DATABASE RESET TOOL ---")
    print("This will create a NEW database, keeping ONLY products.")
    print("All sales, customers, and reports will be lost.")
    
    # Ensure SQLAlchemy isn't holding a lock on the file
    with app.app_context():
        db.engine.dispose()
    
    # 1. Read existing products
    products_to_restore = []
    if os.path.exists(DB_FILE):
        print(f"Reading data from {DB_FILE}...")
        try:
            # Connect using raw sqlite3 to avoid SQLAlchemy overhead/locking for this step
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Check if products table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='products'")
            if cursor.fetchone():
                cursor.execute("SELECT * FROM products")
                rows = cursor.fetchall()
                for row in rows:
                    products_to_restore.append(dict(row))
                print(f" - Found {len(products_to_restore)} products to preserve.")
            else:
                print(" - No products table found in existing DB.")
            
            conn.close()
        except Exception as e:
            print(f"Error reading old database: {e}")
            
        # 2. Backup/Remove old DB
        try:
            if os.path.exists(BACKUP_FILE):
                os.remove(BACKUP_FILE)
            os.rename(DB_FILE, BACKUP_FILE)
            print(f" - Old database moved to {BACKUP_FILE}")
        except Exception as e:
            print(f"Error moving database: {e}")
            print("Make sure the application is not running in another terminal.")
            return
    else:
        print("No existing database found. Creating fresh one.")

    # 3. Create new DB
    print("Initializing new database schema...")
    with app.app_context():
        db.create_all()
        
        # Create Admin User
        if not User.query.filter_by(username='admin').first():
            admin = User(username='admin', role='admin')
            admin.set_password('Admin123!')
            db.session.add(admin)
            print(" - Admin user created (Username: admin / Password: Admin123!)")

        # 4. Restore Products
        if products_to_restore:
            print("Restoring products...")
            count = 0
            for p in products_to_restore:
                try:
                    # Handle boolean conversion for SQLite (0/1 to False/True)
                    is_active = p.get('is_active')
                    if is_active == 1: is_active = True
                    elif is_active == 0: is_active = False
                    
                    new_product = Product(
                        id=p.get('id'), # Keep original ID
                        name=p.get('name'),
                        sku=p.get('sku'),
                        barcode=p.get('barcode'),
                        category=p.get('category'),
                        description=p.get('description'),
                        price=p.get('price'),
                        wholesale_price=p.get('wholesale_price'),
                        cost=p.get('cost'),
                        quantity=p.get('quantity', 0),
                        reorder_level=p.get('reorder_level', 10),
                        unit=p.get('unit', 'pcs'),
                        is_active=is_active,
                        created_at=parse_date(p.get('created_at')),
                        updated_at=parse_date(p.get('updated_at'))
                    )
                    db.session.add(new_product)
                    count += 1
                except Exception as e:
                    print(f"Warning: Could not restore product '{p.get('name')}': {e}")

            db.session.commit()
            print(f" - Successfully restored {count} products.")
        else:
            print(" - No products to restore.")

        print("\nDone! You can now run 'python app.py'")

if __name__ == "__main__":
    reset_database()
