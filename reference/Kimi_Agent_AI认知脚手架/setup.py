#!/usr/bin/env python3
"""
AI认知脚手架CLI工具 - 安装脚本
"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

with open("requirements.txt", "r", encoding="utf-8") as fh:
    requirements = [line.strip() for line in fh if line.strip() and not line.startswith("#")]

setup(
    name="ai-scaffold",
    version="1.0.0",
    author="AI认知脚手架系统",
    author_email="ai-scaffold@example.com",
    description="AI认知脚手架CLI工具 - 强制入口，确保代码修改经过完整工作流",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/example/ai-scaffold",
    py_modules=["cli_tool"],
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Code Generators",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.8",
    install_requires=requirements,
    entry_points={
        "console_scripts": [
            "ai-scaffold=cli_tool:main",
        ],
    },
)
