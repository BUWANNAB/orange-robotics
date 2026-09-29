"""Sign and send one WMS request. Secrets are read from the environment, never printed."""
import argparse
import hashlib
import hmac
import json
import os
import secrets
import time
from urllib.parse import urlparse
import httpx

parser=argparse.ArgumentParser()
parser.add_argument('url',help='Full /openapi/v1/... URL')
parser.add_argument('--method',default='GET',choices=['GET','POST'])
parser.add_argument('--body',help='UTF-8 JSON file')
args=parser.parse_args()
payload=b''
if args.body:
    with open(args.body,encoding='utf-8') as source:
        payload=json.dumps(json.load(source),ensure_ascii=False,separators=(',',':')).encode()
code,secret=os.environ['WMS_APP_CODE'],os.environ['WMS_APP_SECRET']
timestamp,nonce=str(int(time.time())),secrets.token_hex(16)
canonical='\n'.join([args.method,urlparse(args.url).path,code,timestamp,nonce,hashlib.sha256(payload).hexdigest()])
signature=hmac.new(secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()
response=httpx.request(args.method,args.url,content=payload,headers={'Content-Type':'application/json','X-App-Code':code,
    'X-Timestamp':timestamp,'X-Nonce':nonce,'X-Signature':signature},timeout=10,follow_redirects=False)
print(response.status_code)
print(response.text)
