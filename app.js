import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase, ref, onValue, push, set, update, remove } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyA9hxi8keOUJG_mhdD4OSN32A1jypXrXEA",
  authDomain: "grading-dura.firebaseapp.com",
  databaseURL: "https://grading-dura-default-rtdb.firebaseio.com",
  projectId: "grading-dura",
  storageBucket: "grading-dura.firebasestorage.app",
  messagingSenderId: "455000354944",
  appId: "1:455000354944:web:69b96169f6174ec5a8b665",
  measurementId: "G-9J29KM9NHC"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

const STATIC_SUPPLIERS = [
  "CV LEMBAH HIJAU PERKASA",
  "KOPERASI KARYA MANDIRI",
  "TANI RAMPAH JAYA",
  "PT PUTRA UTAMA LESTARI",
  "PT MANUNGGAL ADI JAYA"
];

let currentRole = "staff";
const state = { grading: [], td: [] };

const pageMeta = {
  dashboard:["Dashboard","Ringkasan operasional grading dan Tenera Dura."],
  grading:["Input Grading","Fokus utama pada % kematangan dan total potongan."],
  td:["Input Tenera Dura","Modul terpisah dari grading."],
  rekapGrading:["Rekap Grading","Data grading lengkap per transaksi."],
  rekapTD:["Rekap Tenera Dura","Data Tenera Dura lengkap per transaksi."],
  sheetGrading:["Spreadsheet Grading","Edit manual realtime untuk grading."],
  sheetTD:["Spreadsheet Tenera Dura","Edit manual realtime untuk TD."]
};

const roleEmailMap = {
  staff: "staff@dura.local",
  grading: "grading@dura.local"
};

function $(sel){ return document.querySelector(sel); }
function $all(sel){ return [...document.querySelectorAll(sel)]; }
function num(v){ return Number(v || 0); }
function fixed(v){ return Number(v || 0).toFixed(2); }
function pct(v){ return `${fixed(v)}%`; }
function escapeHtml(s){ return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function dt(iso){ const d=new Date(iso); return {date:d.toLocaleDateString("id-ID"), time:d.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}; }
function dateOnly(iso){ return new Date(iso).toISOString().slice(0,10); }
function setStatus(msg, type="info"){ const el=$("#appStatus"); if(!el) return; el.className=`alert ${type}`; el.textContent=msg; el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"), 3200); }
function clearStatus(){ $("#appStatus")?.classList.add("hidden"); }

function calculateGrading(data){
  const totalBunches = num(data.totalBunches);
  const mentah=num(data.mentah), mengkal=num(data.mengkal), overripe=num(data.overripe), busuk=num(data.busuk), kosong=num(data.kosong), partheno=num(data.partheno), tikus=num(data.tikus);
  const totalCategories = mentah+mengkal+overripe+busuk+kosong+partheno+tikus;
  const masak = totalBunches-totalCategories;
  const toPct = v => totalBunches>0 ? (v/totalBunches)*100 : 0;
  const percentages = { masak:toPct(Math.max(masak,0)), mentah:toPct(mentah), mengkal:toPct(mengkal), overripe:toPct(overripe), busuk:toPct(busuk), kosong:toPct(kosong), partheno:toPct(partheno), tikus:toPct(tikus) };
  const deductions = {
    dasar:3, mentah:percentages.mentah*0.5, mengkal:percentages.mengkal*0.15,
    overripe:percentages.overripe>5 ? (percentages.overripe-5)*0.25 : 0,
    busuk:percentages.busuk, kosong:percentages.kosong, partheno:percentages.partheno*0.15, tikus:percentages.tikus*0.15
  };
  const totalDeduction = Object.values(deductions).reduce((a,b)=>a+b,0);
  let validation = {type:"info", message:"Perhitungan siap disimpan."};
  if(totalCategories>totalBunches) validation = {type:"error", message:"ERROR: Total kategori melebihi Total Janjang."};
  else if(masak<0) validation = {type:"error", message:"ERROR: Masak otomatis negatif."};
  else if(!data.driver || !data.plate || !data.supplier || totalBunches<=0) validation = {type:"warning", message:"WARNING: Lengkapi field wajib dan pastikan input logis."};
  let status="BAIK", statusClass="ok";
  if(totalDeduction>15){ status="BURUK"; statusClass="bad"; }
  else if(totalDeduction>8){ status="PERLU PERHATIAN"; statusClass="warn"; }
  return { totalBunches, mentah, mengkal, overripe, busuk, kosong, partheno, tikus, masak, percentages, deductions, totalDeduction, status, statusClass, validation };
}

function calculateTD(data){
  const tenera=num(data.tenera), dura=num(data.dura), total=tenera+dura;
  const pctTenera = total>0 ? (tenera/total)*100 : 0;
  const pctDura = total>0 ? (dura/total)*100 : 0;
  return { tenera, dura, total, pctTenera, pctDura };
}

function driverNames(){
  return [...new Set([...state.grading.map(x=>x.driver), ...state.td.map(x=>x.driver)].filter(Boolean))].sort();
}

function activeSuppliersFromTransactions(){
  const tx = [...state.grading.map(x=>x.supplier)].filter(Boolean);
  return [...new Set([...STATIC_SUPPLIERS, ...tx])].sort();
}

function supplierStats(rows=state.grading){
  const map={};
  rows.forEach(r=>{
    if(!map[r.supplier]) map[r.supplier] = { name:r.supplier, count:0, totalJanjang:0, masakPct:0, totalDed:0 };
    const x=map[r.supplier]; x.count++; x.totalJanjang+=r.totalBunches; x.masakPct+=r.percentages.masak; x.totalDed+=r.totalDeduction;
  });
  return Object.values(map).map(x=>({...x, avgMasak:x.count?x.masakPct/x.count:0, avgDed:x.count?x.totalDed/x.count:0})).sort((a,b)=>a.avgDed-b.avgDed);
}
function driverStats(rows=state.grading){
  const map={};
  rows.forEach(r=>{
    if(!map[r.driver]) map[r.driver] = { name:r.driver, count:0, totalJanjang:0, masakPct:0, totalDed:0 };
    const x=map[r.driver]; x.count++; x.totalJanjang+=r.totalBunches; x.masakPct+=r.percentages.masak; x.totalDed+=r.totalDeduction;
  });
  return Object.values(map).map(x=>({...x, avgMasak:x.count?x.masakPct/x.count:0, avgDed:x.count?x.totalDed/x.count:0})).sort((a,b)=>b.totalJanjang-a.totalJanjang);
}

function applyRoleUI(){
  $("#roleLabel").textContent = currentRole.toUpperCase();
  $all(".staff-only,.staff-only-page").forEach(el=>el.classList.toggle("hidden", currentRole!=="staff"));
  const active = $(".menu-item.active")?.dataset.page;
  if(currentRole!=="staff" && ["sheetGrading","sheetTD"].includes(active)) switchPage("dashboard");
}

function switchPage(page){
  $all(".menu-item").forEach(b=>b.classList.remove("active"));
  $(`.menu-item[data-page="${page}"]`)?.classList.add("active");
  $all(".page").forEach(p=>p.classList.remove("active"));
  $(`#page-${page}`)?.classList.add("active");
  $("#pageTitle").textContent = pageMeta[page][0];
  $("#pageSubtitle").textContent = pageMeta[page][1];
  $("#summaryCards").classList.toggle("hidden", page !== "dashboard");
  closeSidebar();
}

function metric(label,val){ return `<div class="metric"><span>${label}</span><strong>${val}</strong></div>`; }
function stat(title,meta){ return `<div class="stat"><strong>${escapeHtml(title)}</strong><div class="meta">${meta}</div></div>`; }

function fillStatic(){
  const supplierOpts = activeSuppliersFromTransactions();
  $("#gradingSupplier").innerHTML = '<option value="">Pilih supplier</option>' + supplierOpts.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  const opts = driverNames().map(n=>`<option value="${escapeHtml(n)}"></option>`).join("");
  $("#driverList").innerHTML = opts;
  $("#tdDriverList").innerHTML = opts;
}

function renderSummaryCards(){
  const g=state.grading, td=state.td;
  const totalJanjang=g.reduce((a,x)=>a+x.totalBunches,0);
  const avgMasak=g.length?g.reduce((a,x)=>a+x.percentages.masak,0)/g.length:0;
  const avgDed=g.length?g.reduce((a,x)=>a+x.totalDeduction,0)/g.length:0;
  const avgT=td.length?td.reduce((a,x)=>a+x.pctTenera,0)/td.length:0;
  $("#summaryCards").innerHTML = `
    <div class="summary-card"><span class="label">Total Janjang</span><span class="value">${totalJanjang}</span></div>
    <div class="summary-card"><span class="label">Rata-rata % Masak</span><span class="value">${pct(avgMasak)}</span></div>
    <div class="summary-card hot"><span class="label">Rata-rata Potongan</span><span class="value">${pct(avgDed)}</span></div>
    <div class="summary-card"><span class="label">Rata-rata % Tenera</span><span class="value">${pct(avgT)}</span></div>`;
}

function renderDashboard(){
  const g=state.grading, td=state.td;
  const totalJanjang=g.reduce((a,x)=>a+x.totalBunches,0);
  const avgMasak=g.length?g.reduce((a,x)=>a+x.percentages.masak,0)/g.length:0;
  const avgDed=g.length?g.reduce((a,x)=>a+x.totalDeduction,0)/g.length:0;
  $("#dashGrading").innerHTML = metric("Transaksi", g.length) + metric("Total Janjang", totalJanjang) + metric("% Masak", pct(avgMasak)) + metric("Potongan", pct(avgDed));
  const totalTD=td.reduce((a,x)=>a+x.total,0);
  const avgT=td.length?td.reduce((a,x)=>a+x.pctTenera,0)/td.length:0;
  const avgD=td.length?td.reduce((a,x)=>a+x.pctDura,0)/td.length:0;
  $("#dashTD").innerHTML = metric("Transaksi", td.length) + metric("Total TD", totalTD) + metric("% Tenera", pct(avgT)) + metric("% Dura", pct(avgD));
  const suppliers = supplierStats().slice(0,6);
  $("#dashSuppliers").innerHTML = suppliers.length ? suppliers.map(s=>stat(s.name, `${s.count} trx · ${s.totalJanjang} janjang · Potongan ${pct(s.avgDed)}`)).join("") : `<div class="stat">Belum ada data.</div>`;
  const drivers = driverStats().slice(0,6);
  $("#dashDrivers").innerHTML = drivers.length ? drivers.map(s=>stat(s.name, `${s.count} trx · ${s.totalJanjang} janjang · Potongan ${pct(s.avgDed)}`)).join("") : `<div class="stat">Belum ada data.</div>`;
}

function supplierValueFromForm(fd){
  return (fd.get("supplierManual") || "").trim() || (fd.get("supplierSelect") || "").trim();
}

function renderGradingLive(){
  const form=$("#gradingForm");
  const data=Object.fromEntries(new FormData(form).entries());
  data.supplier = supplierValueFromForm(new FormData(form));
  const calc=calculateGrading(data);
  $("#gradingTotalDeduction").textContent = pct(calc.totalDeduction);
  $("#gradingStatus").textContent = calc.status;
  $("#gradingStatus").className = `status ${calc.statusClass}`;
  const rows = [
    ["Masak",calc.masak,calc.percentages.masak,0],
    ["Mentah",calc.mentah,calc.percentages.mentah,calc.deductions.mentah],
    ["Mengkal",calc.mengkal,calc.percentages.mengkal,calc.deductions.mengkal],
    ["Overripe",calc.overripe,calc.percentages.overripe,calc.deductions.overripe],
    ["Busuk",calc.busuk,calc.percentages.busuk,calc.deductions.busuk],
    ["Tandan Kosong",calc.kosong,calc.percentages.kosong,calc.deductions.kosong],
    ["Parthenocarpi",calc.partheno,calc.percentages.partheno,calc.deductions.partheno],
    ["Makan Tikus",calc.tikus,calc.percentages.tikus,calc.deductions.tikus],
    ["Potongan Dasar","-",0,calc.deductions.dasar]
  ];
  $("#gradingBreakdown").innerHTML = rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${typeof r[2]==="number"?pct(r[2]):r[2]}</td><td>${pct(r[3])}</td></tr>`).join("");
  $("#gradingValidation").className = `alert ${calc.validation.type}`;
  $("#gradingValidation").textContent = calc.validation.message;
}

function renderTDLive(){
  const form=$("#tdForm");
  const data=Object.fromEntries(new FormData(form).entries());
  const calc=calculateTD(data);
  $("#tdTotal").textContent = calc.total;
  $("#tdPctTenera").textContent = pct(calc.pctTenera);
  $("#tdPctDura").textContent = pct(calc.pctDura);
  $("#tdDominant").textContent = calc.pctTenera===calc.pctDura ? "-" : (calc.pctTenera>calc.pctDura ? "Tenera":"Dura");
}

function filteredGradingRows(){
  const q=$("#rekapGradingSearch").value.toLowerCase();
  const s=$("#rekapGradingStart").value, e=$("#rekapGradingEnd").value;
  return state.grading.filter(r=>{
    const hit = !q || [r.driver,r.plate,r.supplier].join(" ").toLowerCase().includes(q);
    const d = dateOnly(r.createdAt);
    const hitStart = !s || d>=s;
    const hitEnd = !e || d<=e;
    return hit && hitStart && hitEnd;
  });
}
function filteredTDRows(){
  const q=$("#rekapTDSearch").value.toLowerCase();
  const s=$("#rekapTDStart").value, e=$("#rekapTDEnd").value;
  return state.td.filter(r=>{
    const hit = !q || [r.driver,r.plate].join(" ").toLowerCase().includes(q);
    const d = dateOnly(r.createdAt);
    const hitStart = !s || d>=s;
    const hitEnd = !e || d<=e;
    return hit && hitStart && hitEnd;
  });
}

function renderRekapGrading(){
  const rows=filteredGradingRows();
  $("#rekapGradingTable").innerHTML = rows.map(r=>{
    const t=dt(r.createdAt);
    return `<tr>
      <td>${t.date}</td><td>${t.time}</td><td>${escapeHtml(r.driver)}</td><td>${escapeHtml(r.plate)}</td><td>${escapeHtml(r.supplier)}</td>
      <td>${r.totalBunches}</td><td>${pct(r.percentages.masak)}</td><td>${pct(r.totalDeduction)}</td>
      <td><div class="action-btns">
        <button class="text-btn" data-edit-grading="${r.id}">Edit</button>
        ${currentRole==="staff" ? `<button class="text-btn danger" data-delete-grading="${r.id}">Hapus</button>`:""}
      </div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9">Belum ada data grading.</td></tr>`;
}
function renderRekapTD(){
  const rows=filteredTDRows();
  $("#rekapTDTable").innerHTML = rows.map(r=>{
    const t=dt(r.createdAt);
    return `<tr>
      <td>${t.date}</td><td>${t.time}</td><td>${escapeHtml(r.driver)}</td><td>${escapeHtml(r.plate)}</td><td>${r.tenera}</td><td>${r.dura}</td><td>${pct(r.pctTenera)}</td><td>${pct(r.pctDura)}</td>
      <td><div class="action-btns">
        <button class="text-btn" data-edit-td="${r.id}">Edit</button>
        ${currentRole==="staff" ? `<button class="text-btn danger" data-delete-td="${r.id}">Hapus</button>`:""}
      </div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9">Belum ada data TD.</td></tr>`;
}

function renderSheetGrading(){
  const q=$("#sheetGradingSearch").value.toLowerCase();
  const rows=state.grading.filter(r=>!q || [r.driver,r.plate,r.supplier].join(" ").toLowerCase().includes(q));
  const cols=[["driver","Sopir"],["plate","Plat"],["supplier","Supplier"],["totalBunches","Total"],["mentah","Mentah"],["mengkal","Mengkal"],["overripe","Overripe"],["busuk","Busuk"],["kosong","Kosong"],["partheno","Partheno"],["tikus","Tikus"],["totalDeduction","Potongan"],["actions","Aksi"]];
  $("#sheetGradingTable").innerHTML = `<thead><tr>${cols.map(c=>`<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${
    rows.map(r=>`<tr data-id="${r.id}">
      ${cols.map(([k])=>{
        if(k==="actions") return `<td><div class="action-btns"><button class="text-btn" data-save-sheet-grading="${r.id}">Simpan</button><button class="text-btn danger" data-delete-grading="${r.id}">Hapus</button></div></td>`;
        const editable=["driver","plate","supplier","totalBunches","mentah","mengkal","overripe","busuk","kosong","partheno","tikus"].includes(k);
        const v = k==="totalDeduction" ? pct(r[k]) : r[k];
        return `<td ${editable?`class="editable" contenteditable="true" data-key="${k}"`:''}>${escapeHtml(v)}</td>`;
      }).join("")}
    </tr>`).join("")
  }</tbody>`;
}
function renderSheetTD(){
  const q=$("#sheetTDSearch").value.toLowerCase();
  const rows=state.td.filter(r=>!q || [r.driver,r.plate].join(" ").toLowerCase().includes(q));
  const cols=[["driver","Sopir"],["plate","Plat"],["tenera","Tenera"],["dura","Dura"],["pctTenera","% Tenera"],["pctDura","% Dura"],["actions","Aksi"]];
  $("#sheetTDTable").innerHTML = `<thead><tr>${cols.map(c=>`<th>${c[1]}</th>`).join("")}</tr></thead><tbody>${
    rows.map(r=>`<tr data-id="${r.id}">
      ${cols.map(([k])=>{
        if(k==="actions") return `<td><div class="action-btns"><button class="text-btn" data-save-sheet-td="${r.id}">Simpan</button><button class="text-btn danger" data-delete-td="${r.id}">Hapus</button></div></td>`;
        const editable=["driver","plate","tenera","dura"].includes(k);
        const v = k.startsWith("pct") ? pct(r[k]) : r[k];
        return `<td ${editable?`class="editable" contenteditable="true" data-key="${k}"`:''}>${escapeHtml(v)}</td>`;
      }).join("")}
    </tr>`).join("")
  }</tbody>`;
}

function refreshAll(){
  fillStatic();
  applyRoleUI();
  renderSummaryCards();
  renderDashboard();
  renderGradingLive();
  renderTDLive();
  renderRekapGrading();
  renderRekapTD();
  if(currentRole==="staff"){
    renderSheetGrading();
    renderSheetTD();
  }
}

function syncLoginEmail(role){
  const email = roleEmailMap[role] || roleEmailMap.staff;
  $("#loginEmail").value = email;
}

function resetGradingForm(){
  const f=$("#gradingForm");
  f.reset();
  f.totalBunches.value=0;
  f.querySelectorAll(".cat").forEach(x=>x.value=0);
  f.editId.value="";
  $("#cancelEditGradingBtn").classList.add("hidden");
  renderGradingLive();
}
function resetTDForm(){
  const f=$("#tdForm");
  f.reset();
  f.tenera.value=0;
  f.dura.value=0;
  f.editId.value="";
  $("#cancelEditTDBtn").classList.add("hidden");
  renderTDLive();
}

async function saveGradingForm(e){
  e.preventDefault();
  clearStatus();
  try{
    const fd=new FormData(e.currentTarget);
    const supplier = supplierValueFromForm(fd);
    const data=Object.fromEntries(fd.entries());
    data.supplier = supplier;
    const calc=calculateGrading(data);
    if(calc.validation.type==="error"){ renderGradingLive(); setStatus(calc.validation.message, "error"); return; }
    if(!supplier){ setStatus("Supplier wajib dipilih atau diketik manual.", "warning"); return; }
    const payload = {
      driver: data.driver.trim(),
      plate: data.plate.trim(),
      supplier: supplier.trim(),
      createdAt: data.editId ? (state.grading.find(x=>x.id===data.editId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      revised: !!data.editId,
      revisedAt: data.editId ? new Date().toISOString() : null,
      ...calc
    };
    if(data.editId){
      await update(ref(db, `grading/${data.editId}`), payload);
      setStatus("Grading berhasil diperbarui.");
    } else {
      await push(ref(db, "grading"), payload);
      setStatus("Grading berhasil disimpan.");
    }
    resetGradingForm();
  }catch(err){
    console.error(err);
    setStatus(`Gagal simpan grading: ${err.message}`, "error");
  }
}

async function saveTDForm(e){
  e.preventDefault();
  clearStatus();
  try{
    const fd=new FormData(e.currentTarget);
    const data=Object.fromEntries(fd.entries());
    const calc=calculateTD(data);
    const payload = {
      driver: data.driver.trim(),
      plate: data.plate.trim(),
      createdAt: data.editId ? (state.td.find(x=>x.id===data.editId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      revised: !!data.editId,
      revisedAt: data.editId ? new Date().toISOString() : null,
      ...calc
    };
    if(data.editId){
      await update(ref(db, `td/${data.editId}`), payload);
      setStatus("Tenera Dura berhasil diperbarui.");
    } else {
      await push(ref(db, "td"), payload);
      setStatus("Tenera Dura berhasil disimpan.");
    }
    resetTDForm();
  }catch(err){
    console.error(err);
    setStatus(`Gagal simpan Tenera Dura: ${err.message}`, "error");
  }
}

function editGrading(id){
  const r=state.grading.find(x=>x.id===id); if(!r) return;
  const f=$("#gradingForm");
  f.editId.value=r.id;
  f.driver.value=r.driver;
  f.plate.value=r.plate;
  if(STATIC_SUPPLIERS.includes(r.supplier)){
    f.supplierSelect.value=r.supplier;
    f.supplierManual.value="";
  }else{
    f.supplierSelect.value="";
    f.supplierManual.value=r.supplier;
  }
  ["totalBunches","mentah","mengkal","overripe","busuk","kosong","partheno","tikus"].forEach(k=>f[k].value=r[k]);
  $("#cancelEditGradingBtn").classList.remove("hidden");
  switchPage("grading");
  renderGradingLive();
}
function editTD(id){
  const r=state.td.find(x=>x.id===id); if(!r) return;
  const f=$("#tdForm");
  f.editId.value=r.id;
  f.driver.value=r.driver;
  f.plate.value=r.plate;
  f.tenera.value=r.tenera;
  f.dura.value=r.dura;
  $("#cancelEditTDBtn").classList.remove("hidden");
  switchPage("td");
  renderTDLive();
}

async function deleteGrading(id){
  if(!confirm("Hapus data grading ini?")) return;
  await remove(ref(db, `grading/${id}`));
  setStatus("Data grading dihapus.");
}
async function deleteTD(id){
  if(!confirm("Hapus data Tenera Dura ini?")) return;
  await remove(ref(db, `td/${id}`));
  setStatus("Data Tenera Dura dihapus.");
}

async function saveSheetGradingRow(id){
  const tr = $(`#sheetGradingTable tr[data-id="${id}"]`); if(!tr) return;
  const row = state.grading.find(x=>x.id===id); if(!row) return;
  const payload = { ...row };
  tr.querySelectorAll("td.editable").forEach(td=>{
    const key=td.dataset.key, val=td.textContent.trim();
    payload[key] = ["driver","plate","supplier"].includes(key) ? val : Number(val || 0);
  });
  Object.assign(payload, calculateGrading(payload));
  payload.revised = true;
  payload.revisedAt = new Date().toISOString();
  await update(ref(db, `grading/${id}`), payload);
  setStatus("Baris grading berhasil diperbarui.");
}
async function saveSheetTDRow(id){
  const tr = $(`#sheetTDTable tr[data-id="${id}"]`); if(!tr) return;
  const row = state.td.find(x=>x.id===id); if(!row) return;
  const payload = { ...row };
  tr.querySelectorAll("td.editable").forEach(td=>{
    const key=td.dataset.key, val=td.textContent.trim();
    payload[key] = ["driver","plate"].includes(key) ? val : Number(val || 0);
  });
  Object.assign(payload, calculateTD(payload));
  payload.revised = true;
  payload.revisedAt = new Date().toISOString();
  await update(ref(db, `td/${id}`), payload);
  setStatus("Baris TD berhasil diperbarui.");
}

function bindRealtime(){
  onValue(ref(db, "grading"), snap=>{
    const val=snap.val()||{};
    state.grading = Object.entries(val).map(([id,v])=>({id,...v})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    refreshAll();
  }, err=>setStatus(`Gagal memuat grading: ${err.message}`,"error"));

  onValue(ref(db, "td"), snap=>{
    const val=snap.val()||{};
    state.td = Object.entries(val).map(([id,v])=>({id,...v})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    refreshAll();
  }, err=>setStatus(`Gagal memuat TD: ${err.message}`,"error"));
}

function openSidebar(){ $("#app").classList.add("sidebar-open"); }
function closeSidebar(){ $("#app").classList.remove("sidebar-open"); }

function initBindings(){
  $all(".role-pick").forEach(btn=>btn.addEventListener("click", ()=>{
    $all(".role-pick").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    syncLoginEmail(btn.dataset.role);
  }));
  syncLoginEmail("staff");

  $("#loginForm").addEventListener("submit", async e=>{
    e.preventDefault();
    const email=$("#loginEmail").value.trim();
    const password=$("#loginPassword").value;
    const errorBox=$("#loginError");
    errorBox.classList.add("hidden");
    try{
      await signInWithEmailAndPassword(auth, email, password);
      $("#loginPassword").value="";
    }catch(error){
      console.error(error);
      errorBox.textContent = ({
        "auth/invalid-credential":"Email atau password salah.",
        "auth/invalid-email":"Format email tidak valid.",
        "auth/user-not-found":"User tidak ditemukan."
      })[error.code] || "Login gagal. Periksa Firebase Authentication.";
      errorBox.classList.remove("hidden");
    }
  });

  onAuthStateChanged(auth, user=>{
    if(user){
      currentRole = user.email === roleEmailMap.staff ? "staff" : "grading";
      $("#userEmail").textContent = user.email || "-";
      $("#loginScreen").classList.add("hidden");
      $("#app").classList.remove("hidden");
      applyRoleUI();
      bindRealtime();
      refreshAll();
    }else{
      $("#app").classList.add("hidden");
      $("#loginScreen").classList.remove("hidden");
      closeSidebar();
    }
  });

  $("#logoutBtn").addEventListener("click", ()=>signOut(auth));
  $all(".menu-item").forEach(btn=>btn.addEventListener("click",()=>switchPage(btn.dataset.page)));
  $("#menuToggle").addEventListener("click", openSidebar);
  $("#mobileOverlay").addEventListener("click", closeSidebar);

  $("#gradingForm").addEventListener("input", renderGradingLive);
  $("#tdForm").addEventListener("input", renderTDLive);
  $("#gradingForm").addEventListener("submit", saveGradingForm);
  $("#tdForm").addEventListener("submit", saveTDForm);
  $("#resetGradingBtn").addEventListener("click", resetGradingForm);
  $("#resetTDBtn").addEventListener("click", resetTDForm);
  $("#cancelEditGradingBtn").addEventListener("click", resetGradingForm);
  $("#cancelEditTDBtn").addEventListener("click", resetTDForm);

  ["rekapGradingSearch","rekapGradingStart","rekapGradingEnd"].forEach(id=>document.getElementById(id).addEventListener("input", renderRekapGrading));
  ["rekapTDSearch","rekapTDStart","rekapTDEnd"].forEach(id=>document.getElementById(id).addEventListener("input", renderRekapTD));
  $("#sheetGradingSearch").addEventListener("input", renderSheetGrading);
  $("#sheetTDSearch").addEventListener("input", renderSheetTD);

  document.addEventListener("click", async e=>{
    const gEdit = e.target.closest("[data-edit-grading]");
    if(gEdit){ editGrading(gEdit.dataset.editGrading); return; }
    const tEdit = e.target.closest("[data-edit-td]");
    if(tEdit){ editTD(tEdit.dataset.editTd); return; }
    const gDel = e.target.closest("[data-delete-grading]");
    if(gDel && currentRole==="staff"){ await deleteGrading(gDel.dataset.deleteGrading); return; }
    const tDel = e.target.closest("[data-delete-td]");
    if(tDel && currentRole==="staff"){ await deleteTD(tDel.dataset.deleteTd); return; }
    const gSave = e.target.closest("[data-save-sheet-grading]");
    if(gSave && currentRole==="staff"){ await saveSheetGradingRow(gSave.dataset.saveSheetGrading); return; }
    const tSave = e.target.closest("[data-save-sheet-td]");
    if(tSave && currentRole==="staff"){ await saveSheetTDRow(tSave.dataset.saveSheetTd); return; }
  });

  $("#globalSearch").addEventListener("input", e=>{
    $("#rekapGradingSearch").value=e.target.value;
    $("#rekapTDSearch").value=e.target.value;
    $("#sheetGradingSearch").value=e.target.value;
    $("#sheetTDSearch").value=e.target.value;
    renderRekapGrading();
    renderRekapTD();
    if(currentRole==="staff"){ renderSheetGrading(); renderSheetTD(); }
  });

  renderGradingLive();
  renderTDLive();
  switchPage("dashboard");
}

initBindings();
