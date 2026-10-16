import React, { useEffect, useState } from 'react';
import { ArrowLeft, BadgeCheck, Box, Check, CircleAlert, ClipboardList, LayoutDashboard, LoaderCircle, LogIn, Package, Plus, Store, UserRound, X } from 'lucide-react';
import './dashboards.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://dukaan-marketplace-api.onrender.com';
const money = value => '₹' + Number(value || 0).toLocaleString('en-IN');
const tokenKey = 'dukaan-customer-token';
const request = async (path, token, options = {}) => {
  const response = await fetch(API_BASE + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Could not load this page.');
  return data;
};

function OrderHistory({ orders }) {
  const [expanded, setExpanded] = useState('');
  return <div className="customer-orders">{orders.map(order => {
    const id = String(order._id);
    const events = order.statusHistory?.length ? order.statusHistory : [{ status: order.status, at: order.updatedAt || order.createdAt, note: 'Current order status' }];
    return <article className="customer-order" key={id}>
      <div className="dashboard-row"><b>#{id.slice(-8)}</b><span>{new Date(order.createdAt).toLocaleDateString('en-IN')}</span><span className={'status-pill '+order.status}>{order.status}</span><b>{money(order.amount)}</b><button className="dashboard-text" onClick={() => setExpanded(expanded === id ? '' : id)}>{expanded === id ? 'Hide tracking' : 'Track order'}</button></div>
      {expanded === id && <div className="order-tracking"><div><strong>Delivery address</strong><span>{order.shipping?.name} · {order.shipping?.pincode}</span></div><ol>{events.map((event, index) => <li className={index === events.length - 1 ? 'current' : ''} key={event._id || `${event.status}-${index}`}><span className="tracking-dot"/><div><b>{event.status}</b><small>{event.note || 'Order updated'} · {new Date(event.at || order.updatedAt || order.createdAt).toLocaleString('en-IN')}</small></div></li>)}</ol><p>{order.items?.map(item => `${item.name} × ${item.quantity}`).join(' · ')}</p></div>}
    </article>;
  })}</div>;
}

export default function DashboardPage({ type, onBack }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey) || '');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [auth, setAuth] = useState({ name: '', email: '', password: '' });
  const [storeName, setStoreName] = useState('');
  const [panel, setPanel] = useState('overview');
  const [data, setData] = useState({ orders: [], products: [], sellers: [], overview: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [product, setProduct] = useState({ sku: '', name: '', brand: '', category: 'Electronics', price: '', stock: '', description: '', image: '' });

  useEffect(() => {
    if (!token) { setUser(null); setData({ orders: [], products: [], sellers: [], overview: null }); return; }
    let cancelled = false;
    (async () => {
      setBusy(true); setError('');
      try {
        const profile = await request('/api/auth/me', token);
        if (cancelled) return;
        setUser(profile.user);
        if (type === 'customer') {
          const orders = await request('/api/orders/mine', token);
          if (!cancelled) setData(d => ({ ...d, orders }));
        }
        if (type === 'seller' && profile.user.role === 'seller' && profile.user.sellerStatus === 'approved') {
          const [products, orders] = await Promise.all([request('/api/seller/products', token), request('/api/seller/orders', token)]);
          if (!cancelled) setData(d => ({ ...d, products, orders }));
        }
        if (type === 'admin' && profile.user.role === 'admin') {
          const [overview, products, orders, sellers] = await Promise.all([request('/api/admin/overview', token), request('/api/admin/products', token), request('/api/admin/orders', token), request('/api/admin/sellers', token)]);
          if (!cancelled) setData({ overview, products, orders, sellers });
        }
      } catch (e) {
        if (!cancelled) { setError(e.message); if (e.message.includes('session') || e.message.includes('Account not found')) { sessionStorage.removeItem(tokenKey); sessionStorage.removeItem('dukaan-admin-token'); setToken(''); } }
      } finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [token, type, reload]);

  async function submitAuth(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const path = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload = authMode === 'register' ? { name: auth.name, email: auth.email, password: auth.password } : { email: auth.email, password: auth.password };
      const result = await request(path, '', { method: 'POST', body: JSON.stringify(payload) });
      sessionStorage.setItem(tokenKey, result.token);
      if (result.user.role === 'admin') sessionStorage.setItem('dukaan-admin-token', result.token);
      setToken(result.token); setUser(result.user); setNotice('Signed in successfully.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function mutate(path, method, body, success) {
    setBusy(true); setError(''); setNotice('');
    try { await request(path, token, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); setNotice(success); setReload(n => n + 1); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function signOut() { sessionStorage.removeItem(tokenKey); sessionStorage.removeItem('dukaan-admin-token'); setToken(''); setUser(null); setData({ orders: [], products: [], sellers: [], overview: null }); }
  async function applySeller(event) { event.preventDefault(); await mutate('/api/auth/seller/apply', 'POST', { storeName }, 'Seller application sent to the Dukaan team.'); }
  async function addProduct(event) {
    event.preventDefault();
    await mutate('/api/seller/products', 'POST', { ...product, price: Number(product.price), stock: Number(product.stock), images: product.image ? [product.image] : [], tags: [] }, 'Listing submitted. It stays hidden until admin review.');
    setProduct({ sku: '', name: '', brand: '', category: 'Electronics', price: '', stock: '', description: '', image: '' });
  }
  async function saveInventory(event, item) {
    event.preventDefault();
    const form = event.currentTarget;
    const price = Number(form.elements.price.value), stock = Number(form.elements.stock.value);
    if (!Number.isFinite(price) || price < 1 || !Number.isInteger(stock) || stock < 0) { setError('Enter a valid price and stock count.'); return; }
    await mutate('/api/admin/products/' + item._id, 'PATCH', { price, stock }, 'Inventory saved.');
  }
  const title = type === 'customer' ? 'Your Dukaan' : type === 'seller' ? 'Seller studio' : 'Store control room';
  const Icon = type === 'customer' ? UserRound : type === 'seller' ? Store : LayoutDashboard;
  const authenticated = Boolean(user);
  const access = authenticated && (type === 'customer' || (type === 'seller' && user.role === 'seller') || (type === 'admin' && user.role === 'admin'));

  return <main className="dashboard-page"><header className="dashboard-top"><button className="dashboard-back" onClick={onBack}><ArrowLeft size={16}/> Back to shop</button><a className="logo" href="#top" onClick={event => { event.preventDefault(); onBack(); }}>dukaan<span>®</span></a>{user ? <button className="dashboard-signout" onClick={signOut}>Sign out</button> : <span className="dashboard-secure">Secure account</span>}</header>
    <section className="dashboard-wrap"><div className="dashboard-heading"><div><span className="eyebrow">DUKAAN · {type === 'customer' ? 'CUSTOMER ACCOUNT' : type === 'seller' ? 'SELLER CENTRE' : 'ADMINISTRATION'}</span><h1>{title}<em>.</em></h1><p>{user ? 'Welcome back, ' + user.name + '.' : 'Sign in to continue to your dashboard.'}</p></div>{user && <span className="dashboard-role"><Icon size={15}/>{user.role}</span>}</div>
      {error && <div className="dashboard-message is-error"><CircleAlert size={16}/>{error}</div>}{notice && <div className="dashboard-message"><Check size={16}/>{notice}</div>}{busy && <div className="dashboard-loading"><LoaderCircle size={16}/> Updating your account…</div>}
      {!authenticated && <form className="dashboard-card dashboard-auth" onSubmit={submitAuth}><div className="dashboard-tabs"><button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Sign in</button><button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Create account</button></div>{authMode === 'register' && <label>Full name<input required autoComplete="name" value={auth.name} onChange={e => setAuth(a => ({ ...a, name: e.target.value }))}/></label>}<label>Email<input type="email" required autoComplete="username" value={auth.email} onChange={e => setAuth(a => ({ ...a, email: e.target.value }))}/></label><label>Password<input type="password" required minLength="8" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={auth.password} onChange={e => setAuth(a => ({ ...a, password: e.target.value }))}/></label><button className="dashboard-primary" disabled={busy}><LogIn size={15}/>{authMode === 'register' ? 'Create account' : 'Sign in'}</button><small>New accounts start with customer access. Seller access is reviewed; admin access is assigned by the store owner.</small></form>}

      {access && type === 'customer' && <><div className="dashboard-nav"><button className={panel === 'overview' ? 'active' : ''} onClick={() => setPanel('overview')}><LayoutDashboard size={15}/> Overview</button><button className={panel === 'orders' ? 'active' : ''} onClick={() => setPanel('orders')}><Package size={15}/> My orders ({data.orders.length})</button><button className="dashboard-link" onClick={onBack}>Continue shopping <ArrowLeft size={14}/></button></div>{panel === 'overview' ? <div className="dashboard-grid"><article className="dashboard-card"><span className="eyebrow">YOUR ORDERS</span><b>{data.orders.length}</b><p>Orders placed with your account.</p><button className="dashboard-text" onClick={() => setPanel('orders')}>View order history →</button></article><article className="dashboard-card"><span className="eyebrow">SAVED ITEMS</span><b>{JSON.parse(localStorage.getItem('dukaan-wishlist-v1') || '[]').length}</b><p>Your saved products stay on this device.</p><button className="dashboard-text" onClick={onBack}>Browse the marketplace →</button></article><article className="dashboard-card"><span className="eyebrow">SELL ON DUKAAN</span><b>Open a store</b><p>Apply to list approved, legal products in the marketplace.</p><button className="dashboard-text" onClick={() => { history.pushState({}, '', '/seller'); window.dispatchEvent(new PopStateEvent('popstate')); }}>Seller centre →</button></article></div> : <div className="dashboard-card"><h2>Order history</h2>{!data.orders.length ? <p>No orders on this account yet.</p> : <div className="dashboard-table"><div className="dashboard-table-head"><span>Order</span><span>Date</span><span>Status</span><span>Total</span><span>Tracking</span></div><OrderHistory orders={data.orders}/></div>}</div>}</>}

      {user && type === 'seller' && user.sellerStatus !== 'approved' && <section className="dashboard-card seller-apply"><Store size={22}/><h2>{user.sellerStatus === 'pending' ? 'Application under review' : user.sellerStatus === 'rejected' ? 'Update your seller application' : 'Start selling on Dukaan'}</h2><p>Tell us your shop name. An admin reviews the application before seller tools unlock. New listings are also reviewed before appearing to shoppers.</p>{user.sellerStatus !== 'pending' && <form onSubmit={applySeller}><label>Store name<input required minLength="2" maxLength="80" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="e.g. Northstar Tech"/></label><button className="dashboard-primary" disabled={busy}><Store size={15}/>Submit for review</button></form>}</section>}
      {access && type === 'seller' && user.sellerStatus === 'approved' && <><div className="dashboard-nav"><button className={panel === 'overview' ? 'active' : ''} onClick={() => setPanel('overview')}><Box size={15}/> Listings ({data.products.length})</button><button className={panel === 'orders' ? 'active' : ''} onClick={() => setPanel('orders')}><ClipboardList size={15}/> Orders ({data.orders.length})</button></div>{panel === 'overview' ? <div className="seller-layout"><form className="dashboard-card seller-product-form" onSubmit={addProduct}><span className="eyebrow">NEW MARKETPLACE LISTING</span><h2>Submit a product</h2><p>Each new listing stays hidden until Dukaan reviews it.</p><label>Product name<input required value={product.name} onChange={e => setProduct(p => ({ ...p, name: e.target.value }))}/></label><div className="dashboard-fields"><label>SKU<input required value={product.sku} onChange={e => setProduct(p => ({ ...p, sku: e.target.value.toUpperCase() }))}/></label><label>Brand<input value={product.brand} onChange={e => setProduct(p => ({ ...p, brand: e.target.value }))}/></label><label>Image URL<input type="url" value={product.image} onChange={e => setProduct(p => ({ ...p, image: e.target.value }))} placeholder="https://…"/></label><label>Price (₹)<input required type="number" min="1" step="1" value={product.price} onChange={e => setProduct(p => ({ ...p, price: e.target.value }))}/></label><label>Stock<input type="number" min="0" step="1" value={product.stock} onChange={e => setProduct(p => ({ ...p, stock: e.target.value }))}/></label><label>Category<select value={product.category} onChange={e => setProduct(p => ({ ...p, category: e.target.value }))}>{['Electronics','Fashion','Beauty','Home','Kitchen','Sports','Accessories','Books'].map(category => <option key={category}>{category}</option>)}</select></label></div><label>Description<textarea rows="3" value={product.description} onChange={e => setProduct(p => ({ ...p, description: e.target.value }))}/></label><button className="dashboard-primary" disabled={busy}><Plus size={15}/>Submit for legal review</button></form><section className="dashboard-card"><span className="eyebrow">YOUR PRODUCTS</span><h2>{user.storeName || 'Store listings'}</h2>{!data.products.length ? <p>No listings yet. Submit your first product.</p> : data.products.map(item => <div className="listing-row" key={item._id}><div><b>{item.name}</b><small>{item.sku} · {item.category}</small></div><strong>{money(item.price)}</strong><span className={'status-pill '+item.legalReview}>{item.legalReview}</span></div>)}</section></div> : <section className="dashboard-card"><h2>Orders containing your products</h2>{!data.orders.length ? <p>No orders for your products yet.</p> : data.orders.map(order => <div className="listing-row" key={order.id}><div><b>#{String(order.id).slice(-8)} · {new Date(order.createdAt).toLocaleDateString('en-IN')}</b><small>{order.items.map(item => item.name + ' × ' + item.quantity).join(', ')}</small></div><span className="status-pill">{order.status}</span>{order.status === 'processing' && <button className="tiny-action approve" onClick={() => mutate('/api/seller/orders/' + order.id + '/status', 'PATCH', { status: 'shipped' }, 'Order marked as shipped.')}>Mark shipped</button>}</div>)}</section>}</>}

      {user && type === 'admin' && user.role !== 'admin' && <div className="dashboard-message is-error"><CircleAlert size={16}/>This account is not an admin account. An existing admin must grant admin access.</div>}
      {access && type === 'admin' && <><div className="dashboard-nav"><button className={panel === 'overview' ? 'active' : ''} onClick={() => setPanel('overview')}><LayoutDashboard size={15}/> Overview</button><button className={panel === 'products' ? 'active' : ''} onClick={() => setPanel('products')}><Box size={15}/> Products ({data.products.length})</button><button className={panel === 'sellers' ? 'active' : ''} onClick={() => setPanel('sellers')}><Store size={15}/> Seller applications ({data.sellers.length})</button><button className={panel === 'orders' ? 'active' : ''} onClick={() => setPanel('orders')}><ClipboardList size={15}/> Orders ({data.orders.length})</button></div>{panel === 'overview' && <div className="dashboard-grid">{[['PRODUCTS',data.overview?.products],['ORDERS',data.overview?.orders],['PAID SALES',money(data.overview?.revenue)]].map(([label,value]) => <article className="dashboard-card" key={label}><span className="eyebrow">{label}</span><b>{value ?? '—'}</b><p>Live figures from the Dukaan database.</p></article>)}</div>}{panel === 'products' && <section className="dashboard-card"><h2>Marketplace listings</h2>{!data.products.length ? <p>No listings found.</p> : data.products.map(item => <div className="listing-row" key={item._id}><div><b>{item.name}</b><small>{item.sku} · {item.category} · {item.seller?.storeName || 'Dukaan'}</small></div><span className={'status-pill '+item.legalReview}>{item.legalReview}</span><form className="admin-inventory-edit" onSubmit={event => saveInventory(event, item)}><label>₹<input aria-label={'Price for '+item.name} name="price" type="number" min="1" defaultValue={item.price}/></label><label>Qty<input aria-label={'Stock for '+item.name} name="stock" type="number" min="0" defaultValue={item.stock}/></label><button className="tiny-action">Save</button></form>{item.legalReview === 'pending' && <><button className="tiny-action approve" onClick={() => mutate('/api/admin/products/' + item._id + '/legal-review', 'PATCH', { decision: 'approved' }, 'Listing approved.')}>Approve</button><button className="tiny-action reject" onClick={() => mutate('/api/admin/products/' + item._id + '/legal-review', 'PATCH', { decision: 'rejected' }, 'Listing rejected.')}>Reject</button></>}</div>)}</section>}{panel === 'sellers' && <section className="dashboard-card"><h2>Seller applications</h2>{!data.sellers.length ? <p>No applications awaiting review.</p> : data.sellers.map(seller => <div className="listing-row" key={seller._id}><div><b>{seller.storeName}</b><small>{seller.name} · {seller.email}</small></div><button className="tiny-action approve" onClick={() => mutate('/api/admin/sellers/' + seller._id + '/review', 'PATCH', { decision: 'approved' }, 'Seller approved.')}>Approve</button><button className="tiny-action reject" onClick={() => mutate('/api/admin/sellers/' + seller._id + '/review', 'PATCH', { decision: 'rejected' }, 'Application declined.')}>Decline</button></div>)}</section>}{panel === 'orders' && <section className="dashboard-card"><h2>Recent orders</h2>{!data.orders.length ? <p>No orders found.</p> : data.orders.map(order => <div className="listing-row" key={order._id}><div><b>#{String(order._id).slice(-8)} · {order.user?.name || 'Customer'}</b><small>{new Date(order.createdAt).toLocaleDateString('en-IN')} · {money(order.amount)}</small></div><span className="status-pill">{order.status}</span><select aria-label={'Update order ' + order._id} value={order.status} onChange={e => mutate('/api/admin/orders/' + order._id, 'PATCH', { status: e.target.value }, 'Order status updated.')}><option value={order.status}>{order.status}</option>{(order.status === 'paid' ? ['processing'] : order.status === 'processing' ? ['shipped'] : order.status === 'shipped' ? ['delivered'] : []).map(status => <option key={status}>{status}</option>)}</select></div>)}</section>}</>}
    </section>
  </main>;
}
