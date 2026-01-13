import sqlite3
import os

# Database file path
DB_FILE = 'pos_secure.db'

def check_database():
    if not os.path.exists(DB_FILE):
        print(f"Error: Database file '{DB_FILE}' not found in current directory.")
        return

    print(f"Checking {DB_FILE}...")
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    try:
        # Check Customers
        print("\n--- CUSTOMERS ---")
        try:
            cursor.execute("SELECT count(*) FROM customers")
            count = cursor.fetchone()[0]
            print(f"Total Customers: {count}")
            
            if count > 0:
                # Check how many are actually active
                cursor.execute("SELECT count(*) FROM customers WHERE is_active = 1")
                active_count = cursor.fetchone()[0]
                print(f"Active Customers: {active_count}")
                if active_count == 0:
                    print("WARNING: All customers are inactive or have NULL status. Run update_db.py to fix.")

                cursor.execute("SELECT id, name, is_active FROM customers LIMIT 5")
                print("Sample Customers:")
                for row in cursor.fetchall():
                    print(f" - ID: {row[0]}, Name: {row[1]}, Active: {row[2]}")
        except sqlite3.OperationalError as e:
            print(f"Error querying customers: {e}")

        # Check Products (just to be sure)
        print("\n--- PRODUCTS ---")
        try:
            cursor.execute("SELECT count(*) FROM products")
            count = cursor.fetchone()[0]
            print(f"Total Products: {count}")
        except sqlite3.OperationalError as e:
            print(f"Error querying products: {e}")

        # Check Stock Movements
        print("\n--- STOCK MOVEMENTS ---")
        try:
            cursor.execute("PRAGMA table_info(stock_movements)")
            columns = [row[1] for row in cursor.fetchall()]
            if columns:
                print(f"Columns: {columns}")
                required_cols = ['quantity', 'user_id', 'reference', 'notes']
                for col in required_cols:
                    if col not in columns:
                        print(f"ERROR: '{col}' column is MISSING in stock_movements table!")
                    else:
                        print(f"OK: '{col}' column exists.")
            else:
                print("Table 'stock_movements' does not exist.")
        except Exception as e:
            print(f"Error checking stock_movements: {e}")

    except Exception as e:
        print(f"General Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    check_database()