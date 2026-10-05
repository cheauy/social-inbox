import re,sys
s=open(sys.argv[1]).read(); out=[]; cur=""; i=0; n=len(s)
while i<n:
    c=s[i]
    if s.startswith("--",i):
        j=s.find("\n",i); j=n if j<0 else j; cur+=s[i:j]; i=j; continue
    if c=="'":
        j=i+1
        while True:
            k=s.find("'",j)
            if k+1<n and s[k+1]=="'": j=k+2; continue
            break
        cur+=s[i:k+1]; i=k+1; continue
    m=re.match(r"\$[A-Za-z_]*\$",s[i:])
    if m:
        tag=m.group(0); k=s.find(tag,i+len(tag)); cur+=s[i:k+len(tag)]; i=k+len(tag); continue
    if c==";":
        out.append(cur.strip()); cur=""; i+=1; continue
    cur+=c; i+=1
if cur.strip(): out.append(cur.strip())
out=[o for o in out if o and not all(l.strip().startswith("--") or not l.strip() for l in o.split("\n"))]
for k,o in enumerate(out): open(f"{sys.argv[2]}/{k:03d}.sql","w").write(o+";\n")
print(len(out),"statements")
