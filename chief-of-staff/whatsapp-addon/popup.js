chrome.storage.local.get("cos").then(({ cos = {} }) => {
  const set = (id, text, cls) => { document.getElementById(id).textContent = text; if (cls) document.getElementById(id === "mode" ? "d1" : "d2").className = `dot ${cls}`; };
  const modes = {
    store: ["Reading all chats (full messages)", "ok"],
    list: ["Reading the chat list only (WhatsApp changed something)", "warn"],
    unavailable: ["Can't read WhatsApp Web right now", "bad"],
    starting: ["Attached. Connecting to WhatsApp Web (up to 2 min)…", "warn"],
  };
  const [label, cls] = modes[cos.mode] || ["Open web.whatsapp.com in a tab", ""];
  set("mode", label, cls);
  if (cos.error) set("conn", `Can't reach Chief of Staff (${cos.error})`, "bad");
  else if (cos.last_ok) set("conn", "Connected to Chief of Staff", "ok");
  else set("conn", "Waiting for the first message", "");
  document.getElementById("seen").textContent = cos.last_seen ? `Last message noticed: ${cos.last_seen}` : "No new messages noticed since the tab loaded.";
  if (cos.last_event) document.getElementById("last").textContent = `Last: ${cos.last_event}`;
});
