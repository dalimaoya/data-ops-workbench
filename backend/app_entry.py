#!/usr/bin/env python3
"""
Entry point for PyInstaller-packaged Data Ops Workbench.
When running as a frozen executable, this script:
1. Determines paths relative to the executable location
2. Initializes the database
3. Starts uvicorn serving the FastAPI app
"""

import os
import sys

def get_base_dir():
    """Get the base directory: parent of server/ in release mode."""
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle
        # The executable is at: <release>/server/app/app (onedir)
        # We need to go up to <release>/
        exe_dir = os.path.dirname(sys.executable)
        # exe_dir = .../server/app/
        # go up twice: server/app -> server -> release root
        base = os.path.dirname(os.path.dirname(exe_dir))
        return base
    else:
        # Development mode
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def setup_environment():
    """Set up environment variables for the packaged app."""
    base_dir = get_base_dir()
    
    # Set DATA_DIR environment variable so database.py can use it
    data_dir = os.path.join(base_dir, 'data')
    os.makedirs(data_dir, exist_ok=True)
    os.environ['DATA_OPS_DATA_DIR'] = data_dir
    os.environ['DATA_OPS_BASE_DIR'] = base_dir
    
    # Create other runtime directories
    for d in ['backups', 'logs']:
        os.makedirs(os.path.join(base_dir, d), exist_ok=True)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Data Ops Workbench Server')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8580')),
                        help='Server port (default: 8580)')
    parser.add_argument('--host', default='0.0.0.0', help='Server host (default: 0.0.0.0)')
    args = parser.parse_args()

    setup_environment()

    import uvicorn
    from app.main import app

    print("============================================")
    print("  数据运维工作台 Data Ops Workbench")
    print("============================================")
    print(f"  访问地址: http://localhost:{args.port}")
    print(f"  默认账号: admin / admin123")
    print(f"  按 Ctrl+C 停止服务")
    print("============================================")
    print()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == '__main__':
    main()
