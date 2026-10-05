import { TENH_BOT_AVAILABLE } from "../../../lib/bot/availability";
import { useEffect, useState } from "react";
import { Alert, Switch, Text, TextInput, View } from "react-native";
import { TabScreen, useWorkspaceResource } from "../../components/screen";
import { Button, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
type Rule = { id: string; name: string; social_account_id: string; post_id: string | null; post_url: string | null; public_template: string | null; private_template: string | null; enabled: boolean };
type Data = { rules: Rule[]; pages: {id: string; account_name: string | null}[]; canManage: boolean; paused: boolean; workerEnabled: boolean; circuitUntil: string | null; history: {id: string; comment_id: string; action: string; status: string; reason: string | null}[] };
export default function Bot() {
  if(!TENH_BOT_AVAILABLE)return <TabScreen title="Tenh Bot" loading={false} error="" onRefresh={() => {}}><View style={{padding:24,gap:12}}><Text style={{fontSize:24,fontWeight:"700"}}>Coming soon</Text><Text style={styles.muted}>Bot configuration and automation are paused.</Text></View></TabScreen>;
  return <BotConfiguration/>;
}
function BotConfiguration() {
  const { data, loading, error, reload, workspace } = useWorkspaceResource<Data>("/api/facebook/auto-reply");
  const [editing, setEditing] = useState(""); const [name, setName] = useState(""); const [page, setPage] = useState("");
  const [specific, setSpecific] = useState(false); const [post, setPost] = useState("");
  const [selectedPages,setSelectedPages]=useState<string[]>([]); const [multiple,setMultiple]=useState(false);
  const [pagePosts,setPagePosts]=useState<Record<string,string>>({}); const [review,setReview]=useState(false);
  const [publicOn, setPublicOn] = useState(true); const [privateOn, setPrivateOn] = useState(false);
  const [publicText, setPublicText] = useState(""); const [privateText, setPrivateText] = useState("");
  const [starts, setStarts] = useState<Record<string,string>>({}); const [comment, setComment] = useState("");
  const [testRule, setTestRule] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const allowed = !!data?.canManage && !busy;
  useEffect(() => { edit(); setNotice(""); setStarts({}); }, [workspace?.businessId]);
  function edit(rule?: Rule) {
    setMultiple(false); setSelectedPages([]); setPagePosts({}); setReview(false);
    setEditing(rule?.id ?? ""); setName(rule?.name ?? ""); setPage(rule?.social_account_id ?? "");
    setSpecific(!!rule?.post_id); setPost(rule?.post_url ?? rule?.post_id ?? "");
    setPublicOn(!!rule?.public_template || !rule); setPrivateOn(!!rule?.private_template);
    setPublicText(rule?.public_template ?? ""); setPrivateText(rule?.private_template ?? "");
  }
  const chosenPages=multiple ? selectedPages : page ? [page] : [];
  const targets=specific ? chosenPages.flatMap(pageId=>(multiple ? pagePosts[pageId] ?? "" : post).split(/\r?\n/).map(value=>value.trim()).filter(Boolean).map(post=>({pageId,post}))) : chosenPages.map(pageId=>({pageId}));
  async function mutate(body: object) {
    if (!workspace || !allowed) return;
    setBusy(true); setNotice("");
    try {
      const result = await api<{ results?: {action: string; reason: string}[] }>("/api/facebook/auto-reply", workspace.businessId, { method: "POST", body });
      await reload();
      setNotice(result.results ? result.results.map(row=>row.action+": "+row.reason.replaceAll("_"," ")).join("\n") : "Saved. Only new comments after activation and your chosen start are eligible.");
    } catch (err) { setNotice((err as Error).message); }
    finally { setBusy(false); }
  }
  function field(label: string, value: string, change: (value: string)=>void, multiline = false) {
    return <View style={{gap:6}}><Text style={{fontWeight:"600",fontSize:14}}>{label}</Text><TextInput
      accessibilityLabel={label} value={value} onChangeText={change} editable={allowed} multiline={multiline}
      autoCapitalize="none" style={[styles.input,multiline && {minHeight:90,textAlignVertical:"top"}]} /></View>;
  }
  function choice(label: string, checked: boolean, change: (checked: boolean)=>void) {
    return <View style={[styles.row,{justifyContent:"space-between"}]}><Text>{label}</Text><Switch
      accessibilityLabel={label} value={checked} onValueChange={change} disabled={!allowed} /></View>;
  }
  return <TabScreen title="Tenh Bot · Comment Auto Reply" loading={loading} error={error} onRefresh={reload}>
    <View style={{gap:16}}>
      <Text style={styles.muted}>Manage Facebook comment replies here. All-post rules include future posts; specific-post rules take priority. Existing replies are skipped. Rules start disabled.</Text>
      {data && !data.workerEnabled && <Text style={styles.muted}>Sending worker is not enabled. Rules will not send until deployment setup is completed.</Text>}
      <Text style={styles.muted}>{data?.paused ? "All sending is paused" : "Enabled rules are ready"}{data?.circuitUntil ? " · Cooldown until "+new Date(data.circuitUntil).toLocaleString() : ""}</Text>
      <Button title={data?.paused ? "Release global pause" : "Pause all"} disabled={!allowed} secondary onPress={()=>{
        if(data?.paused) Alert.alert("Release global pause?","Enabled rules may send replies to new comments.",[{text:"Cancel",style:"cancel"},{text:"Release",onPress:()=>void mutate({operation:"globalPause",paused:false})}]);
        else void mutate({operation:"globalPause",paused:true});
      }} />
      {notice ? <Text accessibilityRole="alert" style={{color:colors.blue}}>{notice}</Text> : null}
      {!data?.canManage && <Text style={styles.muted}>Channel management permission is required to change or test rules.</Text>}
      <View style={[styles.card,{gap:12}]}>
        <Text style={styles.title}>{editing ? "Edit paused rule" : "New rule"}</Text>
        <Text style={{fontWeight:"600"}}>1. Choose Pages and posts</Text>
        {field("Rule name",name,setName)}
        {!editing && choice("Choose several Pages",multiple,setMultiple)}
        {!editing && <Button title="Select all currently connected Pages" secondary disabled={!allowed} onPress={()=>{setMultiple(true);setSelectedPages(data?.pages.map(item=>item.id) ?? []);}} />}
        <Text style={{fontWeight:"600",fontSize:14}}>Connected Page</Text>
        {data?.pages.map(item=><Button key={item.id} title={((multiple ? selectedPages.includes(item.id) : page===item.id) ? "✓ " : "")+(item.account_name ?? item.id)}
          secondary onPress={()=>multiple ? setSelectedPages(current=>current.includes(item.id) ? current.filter(id=>id!==item.id) : [...current,item.id]) : setPage(item.id)} disabled={!allowed} />)}
        {multiple && <Text style={styles.muted}>Select-all is a snapshot. Newly connected Pages require deliberate addition.</Text>}
        {choice("Specific post",specific,setSpecific)}
        {specific ? multiple ? chosenPages.map(id=><View key={id}>{field("Post links for "+(data?.pages.find(p=>p.id===id)?.account_name ?? "Page")+" — one per line",pagePosts[id] ?? "",value=>setPagePosts(current=>({...current,[id]:value})),true)}</View>) : field("Facebook post link or Page_post IDs, one per line",post,setPost,true) : <Text style={styles.muted}>All posts, including future posts</Text>}
        <Text style={{fontWeight:"600"}}>2. Write separate replies</Text>
        {choice("Public reply",publicOn,setPublicOn)}{publicOn && field("Public reply text",publicText,setPublicText,true)}
        {choice("Private reply",privateOn,setPrivateOn)}{privateOn && field("Private reply text",privateText,setPrivateText,true)}
        <Button title="3. Review selection" secondary disabled={!allowed || !targets.length || targets.length>20 || !name} onPress={()=>setReview(true)} />
        {review && <View style={{gap:10}}><Text>{new Set(targets.map(t=>t.pageId)).size} Page(s) · {targets.length} separate disabled Page/post rules. Maximum 20 scopes per save.</Text>
          {targets.map((target,index)=><Text key={index}>{data?.pages.find(p=>p.id===target.pageId)?.account_name} · {"post" in target ? String(target.post) : "All posts, including future posts"}</Text>)}
          {publicOn && <Text>Public: {publicText}</Text>}{privateOn && <Text>Private: {privateText}</Text>}
          <Text style={styles.muted}>Specific posts are verified before saving. Each saved scope is managed separately. Choose a start before enabling; no old comments are backfilled.</Text>
          <Button title="Save disabled" disabled={!allowed || !targets.length || targets.length>20 || (editing!=="" && targets.length!==1)} onPress={()=>void mutate({operation:"save",id:editing||undefined,name,targets,
            scope:specific?"specific":"all",publicTemplate:publicOn?publicText:"",privateTemplate:privateOn?privateText:""})} /></View>}
        {editing && <Button title="Cancel edit" secondary onPress={()=>edit()} />}
      </View>
      <Text style={styles.title}>Rules</Text>
      {data?.rules.map(rule=><View key={rule.id} style={[styles.card,{gap:10}]}>
        <Text style={styles.title}>{rule.name} · {rule.enabled ? "On" : "Off"}</Text>
        <Text style={styles.muted}>{rule.post_id ? "Specific post: "+rule.post_id : "All posts, including future posts"}</Text>
        {!rule.enabled && field("Start date/time with timezone, e.g. 2026-10-01T09:00:00+07:00",starts[rule.id] ?? "",value=>setStarts(current=>({...current,[rule.id]:value})))}
        <Button title={rule.enabled ? "Pause" : "Turn on"} disabled={!allowed || (!rule.enabled && !starts[rule.id])}
          onPress={()=>{
            const body={operation:"toggle",id:rule.id,enabled:!rule.enabled,startsAt:starts[rule.id]};
            if(rule.enabled) void mutate(body);
            else Alert.alert("Review before enabling",`${data?.pages.find(p=>p.id===rule.social_account_id)?.account_name ?? "Page"} · ${rule.post_id ?? "All future posts"}\nStart: ${starts[rule.id]}\nPublic: ${rule.public_template ?? "Off"}\nPrivate: ${rule.private_template ?? "Off"}\n${data?.paused ? "Global sending is paused." : "New comments may receive replies."}`,[{text:"Cancel",style:"cancel"},{text:"Turn on",onPress:()=>void mutate(body)}]);
          }} />
        {!rule.enabled && <Button title="Edit" secondary disabled={!allowed} onPress={()=>edit(rule)} />}
      </View>)}
      <View style={[styles.card,{gap:10}]}><Text style={styles.title}>Read-only test</Text>
        <Text style={styles.muted}>No replies are sent or queued. Turning on still applies the new-only cutoff.</Text>
        {data?.rules.map(rule=><Button key={rule.id} title={(testRule===rule.id?"✓ ":"")+rule.name} secondary disabled={!allowed} onPress={()=>setTestRule(rule.id)} />)}
        {field("Inbox comment ID",comment,setComment)}
        <Button title="Test without sending" disabled={!allowed || !comment || !testRule} onPress={()=>void mutate({operation:"test",id:testRule,commentId:comment})} />
      </View>
      <Text style={styles.title}>Recent history</Text>
      <Text style={styles.muted}>Needs review means Facebook may have sent the reply. Check Facebook before replying manually. Pausing stops queued work; a send already started may finish.</Text>
      {data?.history.map(row=><View key={row.id} style={styles.card}><Text>{row.comment_id} · {row.action} · {row.status.replaceAll("_"," ")}</Text>
        <Text style={styles.muted}>{row.reason?.replaceAll("_"," ") ?? "Queued"}</Text></View>)}
    </View>
  </TabScreen>;
}
