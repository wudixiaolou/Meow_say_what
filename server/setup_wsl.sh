#!/bin/bash
export VENV_DIR=~/.yamnet_venv
rm -rf $VENV_DIR
python3 -m venv $VENV_DIR
source $VENV_DIR/bin/activate
cd "/mnt/c/Users/Lenovo/google Antigravity/Meow_say_what/server"
# Install the latest stable tensorflow
pip install fastapi uvicorn librosa numpy python-multipart tensorflow tensorflow-hub
