"""الاتصال بـ MongoDB. كل الملفات التانية بتاخد الـ database من هنا."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "sentinel")

# Some networks hand out a DNS server that does not answer the SRV/TXT lookups Atlas needs.
# Put MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1 in .env to ask those servers instead.
_dns = os.getenv("MONGO_DNS_SERVERS", "")
if _dns:
    import dns.resolver
    _resolver = dns.resolver.Resolver(configure=False)
    _resolver.nameservers = [s.strip() for s in _dns.split(",") if s.strip()]
    dns.resolver.default_resolver = _resolver

_client = None


def get_db():
    global _client
    if _client is None:
        # fail in 5 seconds instead of 21-30 when MongoDB cannot be reached
        _client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)
    return _client[MONGO_DB]


def get_assets():
    """الـ collection بتاع الأصول."""
    return get_db()["assets"]


# --- W2: الأنواع المرتبطة بالأصول. الـ collections دي هتتملا من أصحابها (Alaa, Omar, Rawda, Amira) ---
def get_incidents():
    return get_db()["incidents"]


def get_findings():
    return get_db()["findings"]


def get_risks():
    return get_db()["risks"]


def get_risk_history():
    """W4: snapshots of every risk over time."""
    return get_db()["risk_history"]


def get_controls():
    return get_db()["controls"]