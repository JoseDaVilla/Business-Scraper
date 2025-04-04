#!/bin/bash

# Find postgresql.conf location (common locations)
POSTGRES_VERSION=$(psql --version | grep -oP '\d+\.?\d+' | head -1)
POSSIBLE_CONF_LOCATIONS=(
  "/etc/postgresql/$POSTGRES_VERSION/main/postgresql.conf"
  "/var/lib/postgresql/$POSTGRES_VERSION/data/postgresql.conf"
  "/usr/local/pgsql/data/postgresql.conf"
)

CONF_FILE=""
for location in "${POSSIBLE_CONF_LOCATIONS[@]}"; do
  if [ -f "$location" ]; then
    CONF_FILE=$location
    break
  fi
done

if [ -z "$CONF_FILE" ]; then
  echo "Could not find postgresql.conf. Please locate it manually."
  exit 1
fi

echo "Found postgresql.conf at $CONF_FILE"

# Modify postgresql.conf to listen on all interfaces
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" $CONF_FILE
echo "Modified postgresql.conf to listen on all interfaces"

# Find pg_hba.conf in the same directory
PG_HBA_FILE=$(dirname "$CONF_FILE")/pg_hba.conf

# Add entry to pg_hba.conf to allow connections from any IP
echo "# Allow connections from any IP" | sudo tee -a $PG_HBA_FILE
echo "host    all             all             0.0.0.0/0               md5" | sudo tee -a $PG_HBA_FILE
echo "Modified pg_hba.conf to allow remote connections"

# Restart PostgreSQL to apply changes
sudo systemctl restart postgresql
echo "PostgreSQL restarted. Remote connections should now be possible."

# Check if PostgreSQL is listening on all interfaces
netstat -tuln | grep 5432
echo "If you see 0.0.0.0:5432 above, PostgreSQL is now listening on all interfaces."

# Remind about firewall
echo "IMPORTANT: Make sure your firewall allows connections on port 5432."
