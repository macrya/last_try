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