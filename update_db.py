import sqlite3
import os

# Database file path
DB_FILE = 'pos_secure.db'

def update_database():
    # Check if file exists
    if not os.path.exists(DB_FILE):
        print(f"Error: Database file '{DB_FILE}' not found in the current directory.")
        return

    print(f"Connecting to {DB_FILE}...")
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    try:
        # 1. Add barcode column
        print("Attempting to add 'barcode' column to products table...")
        try:
            cursor.execute("ALTER TABLE products ADD COLUMN barcode VARCHAR(50)")
            print(" - Column 'barcode' added successfully.")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print(" - Column 'barcode' already exists. Skipping.")
            else:
                raise e

        # 2. Create unique index for barcode (as defined in your model)
        print("Attempting to create unique index for barcode...")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_products_barcode ON products (barcode)")
        print(" - Index 'ix_products_barcode' created/verified.")

        # 3. Remove legacy 'password' column if exists (cleanup for security)
        print("Attempting to remove legacy 'password' column from users table...")
        try:
            cursor.execute("ALTER TABLE users DROP COLUMN password")
            print(" - Legacy column 'password' removed.")
        except sqlite3.OperationalError as e:
            if "no such column" in str(e):
                print(" - Column 'password' does not exist. Clean.")
            else:
                print(f" - Note: Could not remove column (might be old SQLite version): {e}")

        # 4. Fix NULL is_active fields (Data Repair)
        print("Checking for NULL is_active fields...")
        cursor.execute("UPDATE customers SET is_active = 1 WHERE is_active IS NULL")
        if cursor.rowcount > 0:
            print(f" - Fixed {cursor.rowcount} customers with NULL is_active status.")
        
        cursor.execute("UPDATE products SET is_active = 1 WHERE is_active IS NULL")
        if cursor.rowcount > 0:
            print(f" - Fixed {cursor.rowcount} products with NULL is_active status.")

        # 5. Fix missing 'quantity' in stock_movements
        print("Checking for 'quantity' column in stock_movements...")
        try:
            cursor.execute("ALTER TABLE stock_movements ADD COLUMN quantity INTEGER DEFAULT 0")
            print(" - Column 'quantity' added to stock_movements.")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print(" - Column 'quantity' already exists in stock_movements. Skipping.")
            else:
                print(f" - Warning: Could not add column 'quantity': {e}")

        # 6. Fix missing 'user_id' in stock_movements
        print("Checking for 'user_id' column in stock_movements...")
        try:
            cursor.execute("ALTER TABLE stock_movements ADD COLUMN user_id INTEGER")
            print(" - Column 'user_id' added to stock_movements.")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print(" - Column 'user_id' already exists in stock_movements. Skipping.")
            else:
                print(f" - Warning: Could not add column 'user_id': {e}")

        # 7. Fix missing 'reference' in stock_movements
        print("Checking for 'reference' column in stock_movements...")
        try:
            cursor.execute("ALTER TABLE stock_movements ADD COLUMN reference VARCHAR(100)")
            print(" - Column 'reference' added to stock_movements.")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print(" - Column 'reference' already exists in stock_movements. Skipping.")
            else:
                print(f" - Warning: Could not add column 'reference': {e}")

        # 8. Fix missing 'notes' in stock_movements
        print("Checking for 'notes' column in stock_movements...")
        try:
            cursor.execute("ALTER TABLE stock_movements ADD COLUMN notes TEXT")
            print(" - Column 'notes' added to stock_movements.")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print(" - Column 'notes' already exists in stock_movements. Skipping.")
            else:
                print(f" - Warning: Could not add column 'notes': {e}")

        # 9. Fix NULLs in products for dashboard stats
        print("Sanitizing product data for dashboard...")
        cursor.execute("UPDATE products SET quantity = 0 WHERE quantity IS NULL")
        cursor.execute("UPDATE products SET reorder_level = 10 WHERE reorder_level IS NULL")
        
        # 10. Fix NULLs in sales for dashboard stats
        print("Sanitizing sales data for dashboard...")
        cursor.execute("UPDATE sales SET total = 0 WHERE total IS NULL")
        cursor.execute("UPDATE sales SET tax = 0 WHERE tax IS NULL")
        cursor.execute("UPDATE sales SET discount = 0 WHERE discount IS NULL")

        conn.commit()
        print("\nSuccess! Database schema updated.")
        print("You can now run the application using 'python app.py' or 'python app_secure.py'")

    except Exception as e:
        conn.rollback()
        print(f"\nAn error occurred: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    update_database()