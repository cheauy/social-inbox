module.exports=new Proxy({}, {get:(_target,name)=>()=>require('react').createElement('div',{'data-report-fixture':String(name)},String(name))});
