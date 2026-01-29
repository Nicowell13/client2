#!/bin/bash

# ============================================
# Multi-Instance Deployment Script
# Deploy or manage multiple WhatsApp Campaign Manager instances
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

COMPOSE_FILE="docker-compose.multi.yml"
INSTANCES_DIR="instances"

show_help() {
    echo "Usage: $0 [command] [instance_number|all]"
    echo ""
    echo "Commands:"
    echo "  deploy [1-4|all]    Deploy instance(s)"
    echo "  stop [1-4|all]      Stop instance(s)"
    echo "  restart [1-4|all]   Restart instance(s)"
    echo "  status [1-4|all]    Show status of instance(s)"
    echo "  logs [1-4]          Show logs for an instance"
    echo "  build               Build images (run once)"
    echo ""
    echo "Examples:"
    echo "  $0 deploy 1         Deploy instance 1"
    echo "  $0 deploy all       Deploy all 4 instances"
    echo "  $0 status all       Show status of all instances"
    echo "  $0 logs 2           Show logs for instance 2"
}

check_env_file() {
    local instance=$1
    local env_file="${INSTANCES_DIR}/.env.instance${instance}"
    
    if [ ! -f "$env_file" ]; then
        echo -e "${RED}Error: Environment file not found: $env_file${NC}"
        echo "Please create it from the template and fill in your values"
        exit 1
    fi
}

deploy_instance() {
    local instance=$1
    echo -e "${BLUE}Deploying Instance $instance...${NC}"
    
    check_env_file $instance
    
    local env_file="${INSTANCES_DIR}/.env.instance${instance}"
    
    # Export environment variables
    export $(cat "$env_file" | grep -v '^#' | xargs)
    
    # Deploy
    sudo docker compose -f $COMPOSE_FILE -p "whatsapp-instance-${instance}" up -d
    
    echo -e "${GREEN}Instance $instance deployed!${NC}"
    echo "  Frontend: http://localhost:${PORT_FRONTEND}"
    echo "  Backend:  http://localhost:${PORT_BACKEND}"
}

stop_instance() {
    local instance=$1
    echo -e "${YELLOW}Stopping Instance $instance...${NC}"
    
    local env_file="${INSTANCES_DIR}/.env.instance${instance}"
    
    if [ -f "$env_file" ]; then
        export $(cat "$env_file" | grep -v '^#' | xargs)
    else
        export INSTANCE_NUM=$instance
    fi
    
    sudo docker compose -f $COMPOSE_FILE -p "whatsapp-instance-${instance}" down
    
    echo -e "${GREEN}Instance $instance stopped!${NC}"
}

restart_instance() {
    local instance=$1
    stop_instance $instance
    deploy_instance $instance
}

show_status() {
    local instance=$1
    echo -e "${BLUE}Status of Instance $instance:${NC}"
    
    local env_file="${INSTANCES_DIR}/.env.instance${instance}"
    
    if [ -f "$env_file" ]; then
        export $(cat "$env_file" | grep -v '^#' | xargs)
    else
        export INSTANCE_NUM=$instance
    fi
    
    sudo docker compose -f $COMPOSE_FILE -p "whatsapp-instance-${instance}" ps
    echo ""
}

show_logs() {
    local instance=$1
    
    local env_file="${INSTANCES_DIR}/.env.instance${instance}"
    
    if [ -f "$env_file" ]; then
        export $(cat "$env_file" | grep -v '^#' | xargs)
    else
        export INSTANCE_NUM=$instance
    fi
    
    sudo docker compose -f $COMPOSE_FILE -p "whatsapp-instance-${instance}" logs -f
}

build_images() {
    echo -e "${BLUE}Building Docker images...${NC}"
    
    # Build with instance 1 env just to get the build done
    export INSTANCE_NUM=1
    export PORT_FRONTEND=8080
    export PORT_BACKEND=8081
    
    sudo docker compose -f $COMPOSE_FILE build
    
    echo -e "${GREEN}Images built successfully!${NC}"
}

# Main logic
case "${1:-help}" in
    deploy)
        if [ "$2" = "all" ]; then
            for i in 1 2 3 4; do
                deploy_instance $i
                echo ""
            done
        elif [ -n "$2" ] && [ "$2" -ge 1 ] && [ "$2" -le 4 ]; then
            deploy_instance $2
        else
            echo -e "${RED}Error: Please specify instance number (1-4) or 'all'${NC}"
            exit 1
        fi
        ;;
    stop)
        if [ "$2" = "all" ]; then
            for i in 1 2 3 4; do
                stop_instance $i
                echo ""
            done
        elif [ -n "$2" ] && [ "$2" -ge 1 ] && [ "$2" -le 4 ]; then
            stop_instance $2
        else
            echo -e "${RED}Error: Please specify instance number (1-4) or 'all'${NC}"
            exit 1
        fi
        ;;
    restart)
        if [ "$2" = "all" ]; then
            for i in 1 2 3 4; do
                restart_instance $i
                echo ""
            done
        elif [ -n "$2" ] && [ "$2" -ge 1 ] && [ "$2" -le 4 ]; then
            restart_instance $2
        else
            echo -e "${RED}Error: Please specify instance number (1-4) or 'all'${NC}"
            exit 1
        fi
        ;;
    status)
        if [ "$2" = "all" ]; then
            for i in 1 2 3 4; do
                show_status $i
            done
        elif [ -n "$2" ] && [ "$2" -ge 1 ] && [ "$2" -le 4 ]; then
            show_status $2
        else
            echo -e "${RED}Error: Please specify instance number (1-4) or 'all'${NC}"
            exit 1
        fi
        ;;
    logs)
        if [ -n "$2" ] && [ "$2" -ge 1 ] && [ "$2" -le 4 ]; then
            show_logs $2
        else
            echo -e "${RED}Error: Please specify instance number (1-4)${NC}"
            exit 1
        fi
        ;;
    build)
        build_images
        ;;
    *)
        show_help
        ;;
esac
