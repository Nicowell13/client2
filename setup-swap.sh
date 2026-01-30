#!/bin/bash
# ==================================================
# Setup Swap untuk VPS dengan RAM kecil (1GB)
# Jalankan script ini sebagai root di VPS
# ==================================================

echo "🔧 Setting up 2GB swap for low-memory VPS..."

# Check if swap already exists
if [ -f /swapfile ]; then
    echo "⚠️  Swap file already exists. Skipping creation."
else
    # Create 2GB swap file
    echo "📦 Creating 2GB swap file..."
    sudo fallocate -l 2G /swapfile
    
    # Set permissions
    sudo chmod 600 /swapfile
    
    # Setup swap
    sudo mkswap /swapfile
    sudo swapon /swapfile
    
    # Make permanent
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    
    echo "✅ Swap created successfully!"
fi

# Set swappiness (lower = prefer RAM, higher = prefer swap)
echo "🔧 Setting swappiness to 10..."
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf

# Verify
echo ""
echo "📊 Current memory status:"
free -h

echo ""
echo "✅ Swap setup complete!"
echo "📝 You can now run: docker-compose -f docker-compose.lowmem.yml up -d"
