/* Fixture API contract shared by the local browser and real-pager regression test. */
function fixturePage(rows, body) {
  const scoped=rows.filter(row=>(!body.channelId||row.social_account_id===body.channelId)&&(!body.workspaceId||row.business_id===body.workspaceId));
  const views={all:scoped.length,unread:scoped.filter(row=>row.unread_count>0).length,pinned:scoped.filter(row=>row.is_pinned).length,comment:scoped.filter(row=>row.source_type==='comment').length,open:scoped.length,my:0,unassigned:scoped.length};
  const filtered=scoped.filter(row=>(body.status==='all'||row.status===body.status)&&(body.view!=='unread'||row.unread_count>0)&&(body.view!=='pinned'||row.is_pinned)&&(body.view!=='comment'||row.source_type==='comment')&&(body.view!=='my')&&(!body.search||row.contact.full_name.toLowerCase().includes(body.search.toLowerCase())));
  const offset=body.cursor?Math.max(0,filtered.findIndex(row=>row.id===body.cursor.id)+1):0;
  const slice=filtered.slice(offset,offset+30),last=slice.at(-1);
  return {conversations:slice,total:filtered.length,hasMore:offset+slice.length<filtered.length,cursor:last?{id:last.id,pinned:Boolean(last.is_pinned),lastMessageAt:last.last_message_at}:null,
    counts:{views,statusCounts:{all:scoped.length,open:scoped.length,pending:0,resolved:0,closed:0,spam:0},totalUnreadCount:scoped.reduce((sum,row)=>sum+row.unread_count,0),unreadConversationCount:views.unread},
    searchMatches:{},readTargets:[],matchedKnownIds:(body.knownIds||[]).filter(id=>filtered.some(row=>row.id===id)),updates:rows.filter(row=>body.knownIds?.includes(row.id))};
}
const fixturePageResponse=(rows,body)=>Response.json({success:true,page:fixturePage(rows,body)});
module.exports={fixturePage,fixturePageResponse};
