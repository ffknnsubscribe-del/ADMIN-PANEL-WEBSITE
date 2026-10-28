aconst $ = (s) => document.querySelector(s);
let me = null;
let currentPage = new URLSearchParams(location.search).get("page") || "";
const money = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(paise || 0) / 100);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function setAuthView(mode) {
  currentPage = mode; history.replaceState(null, "", mode ? `/?page=${mode}` : "/");
  $("#auth").hidden = !mode || !["login","register"].includes(mode);
  if (!$("#auth").hidden) {
    $("#authTitle").textContent = mode === "register" ? "Create your account" : "Welcome back";
    $("#authSubmit").textContent = mode === "register" ? "Create account" : "Sign in";
    $("#authSwitch").innerHTML = mode === "register"
      ? 'Already registered? <a href="/?page=login" style="color:var(--cyan)">Sign in</a>'
      : 'New here? <a href="/?page=register" style="color:var(--cyan)">Create an account</a>';
    $("#authMessage").textContent = "";
    $("#authForm").querySelector('[name="password"]').autocomplete = mode === "register" ? "new-password" : "current-password";
    $("#auth").scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
async function loadProducts() {
  const { products } = await api("/api/products");
  $("#products").innerHTML = products.length ? products.map(p => `
    <article class="product-card"><div class="product-icon">◇</div><h3>${esc(p.name)}</h3>
    <p>${esc(p.description || "Digital product. Contact support for details.")}</p>
    <div class="price-row"><span class="price">${money(p.price_paise)}</span>
    <button class="btn primary" data-buy="${p.id}">Order now ↗</button></div></article>`).join("") : `<div class="panel"><h3>Products coming soon</h3><p class="muted">The admin can add products after signing in with the admin account.</p></div>`;
}
async function loadOrders() {
  if (!me) return;
  const { orders } = await api("/api/orders");
  $("#orders").hidden = false;
  $("#myOrders").innerHTML = orders.length ? orders.map(o => `
    <article class="order-card"><div class="order-top"><strong>Order #${o.id} · ${esc(o.product_name)}</strong><strong>${money(o.amount_paise)}</strong></div>
    <div class="muted">Quantity: ${o.quantity} · ${new Date(o.created_at).toLocaleString()}</div>
    <div class="inline-controls"><span class="tag ${esc(o.payment_status)}">Payment: ${esc(o.payment_status)}</span><span class="tag ${esc(o.order_status)}">Order: ${esc(o.order_status)}</span></div>
    ${o.delivery_note ? `<div><strong>Delivery details</strong><p>${esc(o.delivery_note).replace(/\n/g,"<br>")}</p></div>` : `<p class="muted">Delivery details will appear here after the admin processes your order.</p>`}
    </article>`).join("") : `<div class="panel"><p class="muted">No orders yet. Browse the store to place your first order.</p></div>`;
}
async function loadAdmin() {
  const [summary, products, orders, customers] = await Promise.all([
    api("/api/admin/summary"), api("/api/admin/products"), api("/api/admin/orders"), api("/api/admin/customers")
  ]);
  $("#admin").hidden = false;
  $("#stats").innerHTML = [
    ["Customers",summary.customers],["Products",summary.products],["Orders",summary.orders],["Pending payments",summary.pendingPayments]
  ].map(([label,value])=>`<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  $("#adminProducts").innerHTML = products.products.length ? products.products.map(p=>`
    <div class="row-card"><div class="order-top"><strong>${esc(p.name)}</strong><strong>${money(p.price_paise)}</strong></div>
    <div class="muted">${p.active ? "Visible in store" : "Hidden from store"}</div>
    <button class="btn ghost" data-toggle-product="${p.id}" data-active="${p.active}">${p.active ? "Hide product" : "Publish product"}</button></div>`).join("") : `<p class="muted">No products yet.</p>`;
  $("#adminOrders").innerHTML = orders.orders.length ? orders.orders.map(o=>`
    <div class="row-card"><div class="order-top"><strong>#${o.id} · ${esc(o.product_name)}</strong><strong>${money(o.amount_paise)}</strong></div>
    <div class="muted">${esc(o.email)} · Qty ${o.quantity} · ${new Date(o.created_at).toLocaleString()}</div>
    <div class="inline-controls"><label>Payment<select id="pay-${o.id}"><option ${o.payment_status==="pending"?"selected":""}>pending</option><option ${o.payment_status==="paid"?"selected":""}>paid</option><option ${o.payment_status==="rejected"?"selected":""}>rejected</option></select></label>
    <label>Order status<select id="status-${o.id}"><option ${o.order_status==="pending"?"selected":""}>pending</option><option ${o.order_status==="processing"?"selected":""}>processing</option><option ${o.order_status==="completed"?"selected":""}>completed</option><option ${o.order_status==="cancelled"?"selected":""}>cancelled</option></select></label></div>
    <label>Delivery note / digital key<textarea id="note-${o.id}" rows="2" maxlength="2000">${esc(o.delivery_note)}</textarea></label>
    <button class="btn primary" data-save-order="${o.id}">Save order</button></div>`).join("") : `<p class="muted">No orders yet.</p>`;
  $("#customers").innerHTML = customers.customers.length ? customers.customers.map(c=>`<div class="row-card"><strong>${esc(c.email)}</strong><span class="muted">Customer since ${new Date(c.created_at).toLocaleDateString()}</span></div>`).join("") : `<p class="muted">No customers yet.</p>`;
}
async function refreshMe() {
  const data = await api("/api/me"); me = data.user;
  $("#userLabel").textContent = me ? me.email : "";
  $("#logoutBtn").hidden = !me; $("#loginLink").hidden = !!me;
  $("#ordersNav").hidden = !me; $("#adminNav").hidden = !me || me.role !== "admin";
  if (me && me.role === "admin") await loadAdmin();
  if (me) await loadOrders();
}
document.addEventListener("click", async (event) => {
  const buy = event.target.closest("[data-buy]");
  const toggle = event.target.closest("[data-toggle-product]");
  const save = event.target.closest("[data-save-order]");
  try {
    if (buy) {
      if (!me) { setAuthView("login"); toast("Sign in to place an order."); return; }
      const qty = Number(prompt("Quantity (1–10)", "1") || "1");
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) return toast("Enter a quantity from 1 to 10.");
      const result = await api("/api/orders", { method:"POST", body:JSON.stringify({ productId:Number(buy.dataset.buy), quantity:qty }) });
      toast(`Order #${result.order.id} created.`);
      await loadOrders(); $("#orders").scrollIntoView({behavior:"smooth"});
    }
    if (toggle) {
      await api(`/api/admin/products/${toggle.dataset.toggleProduct}`, { method:"PATCH", body:JSON.stringify({ active:toggle.dataset.active !== "true" }) });
      await loadAdmin(); await loadProducts(); toast("Product updated.");
    }
    if (save) {
      const id = save.dataset.saveOrder;
      await api(`/api/admin/orders/${id}`, { method:"PATCH", body:JSON.stringify({
        payment_status:$(`#pay-${id}`).value, order_status:$(`#status-${id}`).value, delivery_note:$(`#note-${id}`).value
      })});
      await loadAdmin(); await loadOrders(); toast("Order saved.");
    }
  } catch (e) { toast(e.message); }
});
$("#authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const mode = currentPage === "register" ? "register" : "login";
  try {
    const data = await api(`/api/auth/${mode}`, { method:"POST", body:JSON.stringify({ email:form.get("email"), password:form.get("password") }) });
    me = data.user; toast(mode === "register" ? "Account created." : "Signed in.");
    $("#auth").hidden = true; history.replaceState(null,"","/");
    await refreshMe();
    if (me.role === "admin") { $("#admin").hidden=false; $("#admin").scrollIntoView({behavior:"smooth"}); }
  } catch (err) { $("#authMessage").textContent = err.message; }
});
$("#logoutBtn").addEventListener("click", async () => {
  try { await api("/api/auth/logout",{method:"POST",body:"{}"}); me=null; $("#admin").hidden=true; $("#orders").hidden=true; await refreshMe(); toast("Signed out."); }
  catch(e){toast(e.message);}
});
$("#refreshOrders").addEventListener("click",()=>loadOrders().catch(e=>toast(e.message)));
$("#refreshAdmin").addEventListener("click",()=>loadAdmin().catch(e=>toast(e.message)));
$("#productForm").addEventListener("submit",async e=>{
  e.preventDefault(); const f=new FormData(e.currentTarget);
  try { await api("/api/admin/products",{method:"POST",body:JSON.stringify({name:f.get("name"),description:f.get("description"),price:f.get("price")})}); e.currentTarget.reset(); $("#productMessage").textContent="Product added."; await loadAdmin(); await loadProducts(); }
  catch(err){$("#productMessage").textContent=err.message;}
});
async function boot() {
  try {
    const config = await api("/api/config"); if(config.supportContact) $("#support").textContent = `Support: ${config.supportContact}`;
    await loadProducts(); await refreshMe();
    if (currentPage === "login" || currentPage === "register") setAuthView(currentPage);
    if (currentPage === "admin") {
      if (!me) setAuthView("login");
      else if (me.role !== "admin") toast("This account is not an admin.");
      else { $("#admin").hidden=false; $("#admin").scrollIntoView({behavior:"smooth"}); }
    }
  } catch(e) { toast(e.message); }
}
boot();
