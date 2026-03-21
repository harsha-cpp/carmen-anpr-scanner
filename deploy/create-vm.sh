#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="anpr-rg"
VM_NAME="anpr-vm"
LOCATION="eastus"
VM_SIZE="Standard_B2s"
ADMIN_USER="azureuser"
APP_PORT="3001"
WS_PORT="3002"

echo "Creating resource group..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output table

echo "Creating VM (Ubuntu 22.04, $VM_SIZE)..."
az vm create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --image Ubuntu2204 \
  --size "$VM_SIZE" \
  --admin-username "$ADMIN_USER" \
  --generate-ssh-keys \
  --output table

echo "Opening ports $APP_PORT (Next.js) and $WS_PORT (WebSocket)..."
az vm open-port \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --port "$APP_PORT" \
  --priority 1001

az vm open-port \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --port "$WS_PORT" \
  --priority 1002

VM_IP=$(az vm show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --show-details \
  --query publicIps \
  --output tsv)

echo ""
echo "VM created: $VM_IP"
echo ""
echo "Next steps:"
echo "  1. Copy SDK to VM:"
echo "     scp carmen_video_sdk-1.2.1.35130.zip $ADMIN_USER@$VM_IP:~/"
echo ""
echo "  2. Run setup on VM:"
echo "     scp deploy/setup-vm.sh $ADMIN_USER@$VM_IP:~/"
echo "     ssh $ADMIN_USER@$VM_IP 'bash setup-vm.sh'"
echo ""
echo "  3. Copy .env files:"
echo "     scp apps/web/.env $ADMIN_USER@$VM_IP:~/app/apps/web/.env"
echo "     scp apps/ws-server/.env $ADMIN_USER@$VM_IP:~/app/apps/ws-server/.env"
echo "     ssh $ADMIN_USER@$VM_IP 'cd ~/app && sed -i \"s|NEXT_PUBLIC_WS_URL=.*|NEXT_PUBLIC_WS_URL=ws://$VM_IP:3002|\" apps/web/.env'"
echo ""
echo "  4. Start the app:"
echo "     ssh $ADMIN_USER@$VM_IP 'cd ~/app && npx pm2 start ecosystem.config.cjs && npx pm2 save'"
echo ""
echo "  App will be at: http://$VM_IP:3001"
