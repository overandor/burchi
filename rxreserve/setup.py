from setuptools import setup, find_packages

setup(
    name="rxreserve",
    version="1.0.0",
    description="Pharmaceutical Frontier Reserve — market in unresolved pharmaceutical value with employee attribution",
    packages=find_packages(),
    python_requires=">=3.9",
    install_requires=[
        "fastapi>=0.100.0",
        "uvicorn>=0.23.0",
        "httpx>=0.24.0",
        "pyyaml>=6.0",
        "numpy>=1.24.0",
        "playwright>=1.40.0",
        "Pillow>=10.0.0",
    ],
    entry_points={
        "console_scripts": [
            "rxreserve=rxreserve.cli:main",
        ],
    },
)
