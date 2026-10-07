const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),M1=id(11),M2=id(12),U=id(21);
const start='2026-10-05T00:00:00Z',end='2026-10-06T00:00:00Z',snapshot='2026-10-06T12:00:00Z';
const members=[{id:M1,business_id:A,user_id:U,role:'owner',is_active:true,full_name:'Human One'},
 {id:M2,business_id:A,user_id:id(22),role:'agent',is_active:true,full_name:'Human Two'}];
const accounts=[['facebook',31,A],['telegram',32,A],['telegram_personal',33,A],['facebook',34,B]]
 .map(([platform,n,business_id])=>({id:id(n),business_id,platform,account_name:'Isolated '+platform}));
const conversations=Array.from({length:17},(_,j)=>{const n=j+1,platform=n===2?'telegram':n===9?'telegram_personal':'facebook',business_id=n===10?B:A;
 return {id:id(200+n),business_id,platform,social_account_id:id(n===10?34:n===9?33:n===2?32:31),source_type:n===5?'comment':'messenger',
 status:n===2?'closed':n===11?'spam':'open',assigned_to:[4,6,12,13,14,17,11].includes(n)?null:n===15?M2:M1,
 unread_count:({1:2,4:5,5:2,6:2,9:7,11:1,12:1,13:3,14:1,17:4})[n]??0,contact_id:id(100+n),
 created_at:n===2||n===5?'2026-10-05T00:01:00Z':'2026-09-01T00:00:00Z',
 status_updated_at:n===2?'2026-10-05T01:05:00Z':'2026-10-05T00:11:00Z',updated_at:'2026-10-05T00:11:00Z'};});
const contacts=conversations.map((c,i)=>({id:c.contact_id,business_id:c.business_id,platform:c.platform,platform_user_id:String(i+1),
 full_name:[1,2].includes(i+1)?'Same display name':'Synthetic Contact '+(i+1),created_at:[2,5].includes(i+1)?'2026-10-05T00:01:00Z':'2026-09-01T00:00:00Z'}));
contacts.push(...[98,99].map(n=>({id:id(100+n),business_id:A,platform:'facebook',platform_user_id:String(n),full_name:'New inactive contact',created_at:'2026-10-05T10:00:00Z'})));
let serial=400;
const messages=[];
function message(n,direction,at,member=null,raw={},stored=at){const c=conversations[n-1];messages.push({id:id(++serial),business_id:c.business_id,conversation_id:c.id,
 direction,platform_created_at:at,created_at:stored,platform_message_id:'fixture-'+serial,sent_by_member_id:member,raw_payload:raw});}
const at=time=>'2026-10-05T'+time+':00Z';
message(1,'incoming',at('00:00'));message(1,'incoming',at('00:02'));message(1,'outgoing',at('00:05'),M1);message(1,'outgoing',at('00:09'),M2);
message(2,'outgoing','2026-10-04T23:00:00Z',M2);message(2,'incoming',at('01:00'));message(2,'outgoing',at('01:02'),M2);
message(3,'incoming',at('02:00'));message(3,'outgoing',at('02:01'),null,{auto_reply_job_id:'fixture-bot'});message(3,'outgoing',at('02:08'),M1);
message(4,'incoming',at('03:00'));message(5,'incoming',at('04:00'));message(5,'incoming',at('04:01'));message(5,'outgoing',at('04:03'),M1);
message(6,'incoming',end);message(7,'incoming',at('23:58'));message(7,'outgoing',end,M1);
message(8,'incoming',at('01:00'));message(8,'outgoing',at('01:01'));message(8,'outgoing',at('01:07'),M1);
message(9,'incoming',at('01:05'));message(9,'outgoing',at('02:00'),M1);
message(10,'incoming',at('10:00'));message(10,'outgoing',at('10:01'),id(90));
message(11,'incoming',at('08:00'));message(12,'incoming','2026-09-30T04:00:00Z');
message(13,'incoming',at('05:05'));message(13,'incoming',at('05:08'));message(13,'outgoing',at('05:06'),null,{tenh_bot_job_id:'fixture-bot'});
message(13,'incoming','2026-10-04T01:00:00Z');message(13,'outgoing','2026-10-04T01:05:00Z',M1);
message(14,'incoming','2026-10-06T11:55:00Z');
message(15,'incoming',at('20:00'),null,{},'2026-10-06T02:00:00Z');message(15,'outgoing',at('20:03'),M2,{},'2026-10-06T01:00:00Z');
message(16,'outgoing',at('10:01'),M1);message(16,'outgoing',at('10:02'),M2);message(16,'system',at('10:03'));
message(17,'incoming','2026-10-04T22:00:00Z');message(17,'outgoing','2026-10-04T22:01:00Z');
const activity=(n,when,oldStatus,newStatus)=>({id:id(++serial),business_id:A,conversation_id:id(200+n),actor_member_id:M1,
 activity_type:'status_changed',created_at:when,metadata:{oldStatus,newStatus}});
const activities=[activity(1,at('00:10'),'open','closed'),activity(1,'2026-10-05T00:10:10Z','open','closed'),activity(1,at('00:11'),'closed','open'),
 activity(2,at('01:05'),'open','closed'),activity(13,at('05:00'),'closed','open')];
const reminder=(n,when,status='open')=>({id:id(++serial),business_id:conversations[n-1].business_id,conversation_id:id(200+n),assigned_to:M1,remind_at:when,status});
const reminders=[reminder(1,'2026-10-04T10:00:00Z'),reminder(4,'2026-10-06T10:00:00Z'),reminder(4,'2026-10-06T11:00:00Z'),
 reminder(9,at('05:00')),reminder(10,at('05:00')),reminder(2,at('05:00'),'completed'),reminder(14,'2026-10-06T13:00:00Z')];
async function seed(db){for(const [table,rows] of Object.entries({team_members:members,social_accounts:accounts,contacts,conversations,messages,conversation_activity:activities,conversation_reminders:reminders})){
 for(const row of rows){const keys=Object.keys(row);await db.query(`INSERT INTO public.${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));}}
 // Redelivery with the same provider identity must not add an event.
 const duplicate={...messages[0],id:id(999)};await db.query('INSERT INTO public.messages(id,business_id,platform_message_id) VALUES($1,$2,$3) ON CONFLICT (business_id,platform_message_id) DO NOTHING',[duplicate.id,A,duplicate.platform_message_id]);
}
module.exports={id,A,B,M1,M2,U,start,end,snapshot,members,accounts,contacts,conversations,messages,activities,reminders,seed};
