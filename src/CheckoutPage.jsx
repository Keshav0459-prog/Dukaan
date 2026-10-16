import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Minus, Plus, ShieldCheck, ShoppingBag } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://dukaan-marketplace-api.onrender.com';
const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
const getImgUrl = img => !img ? '' : (img.startsWith('/') || img.startsWith('http')) ? img : `https://images.unsplash.com/${img}?auto=format&fit=crop&w=300&q=80`;

export default function CheckoutPage({ products, cart, onQty, onBack, initialPromo = '', paymentCancelled = false }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('dukaan-customer-token') || '');
  const [authMode, setAuthMode] = useState('signin');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [shipping, setShipping] = useState({ name: '', email: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', pincode: '' });
  const [coupon, setCoupon] = useState(initialPromo);
  const [couponApplied, setCouponApplied] = useState(initialPromo === 'DUKAAN10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cartKey = p => String(p.sku || p.id || p._id || '');
  const lines = useMemo(() => products.filter(p => cart[cartKey(p)]).map(p => ({ ...p, cartKey: cartKey(p), quantity: cart[cartKey(p)] })), [products, cart]);
  const subtotal = lines.reduce((total, p) => total + p.price * p.quantity, 0);
  const discount = couponApplied ? Math.round(subtotal * 0.1) : 0;
  const shippingFee = subtotal >= 5000 ? 0 : 99;
  const setField = (field, value) => setShipping(s => ({ ...s, [field]: value }));

  async function authenticate(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const path = authMode === 'signup' ? 'register' : 'login';
      const payload = authMode === 'signup' ? { name: authName, email: authEmail, password: authPassword } : { email: authEmail, password: authPassword };
      const response = await fetch(`${API_BASE}/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Could not sign in.');
      setToken(data.token); sessionStorage.setItem('dukaan-customer-token', data.token);
      setField('email', data.user.email); if (authMode === 'signup') setField('name', data.user.name);
      setError('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function placeOrder(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/api/orders/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          items: lines.map(p => ({ sku: p.sku, quantity: p.quantity })),
          shipping,
          promoCode: couponApplied ? 'DUKAAN10' : ''
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not start secure checkout.');

      if (data.gateway === 'razorpay') {
        const loadScript = () => new Promise(resolve => {
          if (window.Razorpay) return resolve(true);
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve(true);
          script.onerror = () => resolve(false);
          document.body.appendChild(script);
        });

        const loaded = await loadScript();
        if (!loaded) throw new Error('Razorpay SDK failed to load. Please check your internet connection.');

        const options = {
          key: data.keyId,
          amount: data.amount,
          currency: data.currency || 'INR',
          name: 'Dukaan Market',
          description: 'Marketplace Order Payment',
          image: '/favicon.svg',
          order_id: data.razorpayOrderId,
          prefill: {
            name: data.customer?.name || shipping.name,
            email: data.customer?.email || shipping.email,
            contact: data.customer?.phone || shipping.phone
          },
          theme: {
            color: '#111827'
          },
          method: {
            upi: true,
            card: true,
            netbanking: true,
            wallet: true
          },
          config: {
            display: {
              blocks: {
                upi: {
                  name: "Pay using UPI (Google Pay, PhonePe, Paytm, QR)",
                  instruments: [
                    {
                      method: "upi"
                    }
                  ]
                },
                other: {
                  name: "Cards, Netbanking & Wallets",
                  instruments: [
                    { method: "card" },
                    { method: "netbanking" },
                    { method: "wallet" }
                  ]
                }
              },
              sequence: ["block.upi", "block.other"],
              preferences: {
                show_default_blocks: true
              }
            }
          },
          handler: async function (paymentRes) {
            try {
              setBusy(true);
              const verifyRes = await fetch(`${API_BASE}/api/orders/verify-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  razorpay_order_id: paymentRes.razorpay_order_id,
                  razorpay_payment_id: paymentRes.razorpay_payment_id,
                  razorpay_signature: paymentRes.razorpay_signature,
                  dukaan_order_id: data.dukaanOrderId
                })
              });
              const verifyData = await verifyRes.json();
              if (!verifyRes.ok) throw new Error(verifyData.message || 'Payment signature verification failed.');
              window.location.assign(`/?checkout=success&order_id=${encodeURIComponent(data.dukaanOrderId)}`);
            } catch (err) {
              setError(err.message || 'Payment confirmation error.');
              setBusy(false);
            }
          },
          modal: {
            ondismiss: function () {
              setBusy(false);
              setError('Payment process was dismissed or closed.');
            }
          }
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function (res) {
          setError(res.error?.description || 'Payment failed. Please try another payment method.');
          setBusy(false);
        });
        rzp.open();
        return;
      }

      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      throw new Error('Secure payment link was not returned.');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!lines.length) return <section className="checkout-empty"><ShoppingBag size={28}/><h1>Your bag is empty</h1><button className="dark-cta" onClick={onBack}>Back to shopping <ArrowRight size={16}/></button></section>;

  return <main className="checkout-page"><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to shopping</button>{paymentCancelled&&<div className="cancelled-note">Payment wasn’t completed. Your bag is saved—review it and try again.</div>}<div className="checkout-heading"><div><span className="eyebrow">DUKAAN · SECURE CHECKOUT</span><h1>Almost <em>yours.</em></h1><p>Delivery details first. Your payment is completed securely through Razorpay.</p></div><span className="checkout-lock"><LockKeyhole size={15}/> Secure checkout</span></div>
    <div className="checkout-layout"><form id="shipping-form" className="checkout-form" onSubmit={placeOrder}>
      <section className="checkout-section"><div className="checkout-step"><span>1</span><div><h2>Delivery details</h2><p>Where should we send your order?</p></div></div><div className="checkout-fields"><label className="span-two">Full name<input required autoComplete="name" value={shipping.name} onChange={e=>setField('name',e.target.value)}/></label><label>Email address<input type="email" required autoComplete="email" value={shipping.email} onChange={e=>setField('email',e.target.value)}/></label><label>Phone number<input type="tel" required pattern="[0-9+ ()-]{10,16}" autoComplete="tel" placeholder="+91" value={shipping.phone} onChange={e=>setField('phone',e.target.value)}/></label><label className="span-two">Address<input required autoComplete="address-line1" value={shipping.addressLine1} onChange={e=>setField('addressLine1',e.target.value)}/></label><label className="span-two">Apartment, floor, landmark <span>Optional</span><input autoComplete="address-line2" value={shipping.addressLine2} onChange={e=>setField('addressLine2',e.target.value)}/></label><label>City<input required autoComplete="address-level2" value={shipping.city} onChange={e=>setField('city',e.target.value)}/></label><label>State<input required autoComplete="address-level1" value={shipping.state} onChange={e=>setField('state',e.target.value)}/></label><label>PIN code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="postal-code" value={shipping.pincode} onChange={e=>setField('pincode',e.target.value.replace(/\D/g,'').slice(0,6))}/></label></div></section>
      <section className="checkout-section"><div className="checkout-step"><span>2</span><div><h2>Your account</h2><p>Sign in or create an account to continue.</p></div></div>{token?<div className="signed-in"><Check size={16}/> Signed in and ready to pay securely.<button type="button" onClick={()=>{setToken('');sessionStorage.removeItem('dukaan-customer-token')}}>Sign out</button></div>:<><div className="auth-switch"><button type="button" className={authMode==='signin'?'active':''} onClick={()=>setAuthMode('signin')}>Sign in</button><button type="button" className={authMode==='signup'?'active':''} onClick={()=>setAuthMode('signup')}>Create account</button></div><div className="checkout-fields auth-fields">{authMode==='signup'&&<label className="span-two">Your name<input required autoComplete="name" value={authName} onChange={e=>setAuthName(e.target.value)}/></label>}<label>Email<input type="email" required autoComplete="username" value={authEmail} onChange={e=>setAuthEmail(e.target.value)}/></label><label>Password<input type="password" required minLength="8" autoComplete={authMode==='signup'?'new-password':'current-password'} value={authPassword} onChange={e=>setAuthPassword(e.target.value)}/></label></div><button className="secondary-cta" type="button" onClick={authenticate} disabled={busy}>{authMode==='signup'?'Create account':'Sign in'} <ArrowRight size={15}/></button></>}</section>
      <section className="checkout-section payment-info"><div className="checkout-step"><span>3</span><div><h2>Payment</h2><p>Pay securely with Razorpay.</p></div></div><div className="payment-method-note"><ShieldCheck size={18}/><span>Instant UPI (Google Pay, PhonePe, Paytm), RuPay / Visa / MasterCard debit & credit cards, and Netbanking.</span></div></section>
      {error&&<div className="checkout-error" role="alert">{error}</div>}
      <button className="dark-cta checkout-submit" type="submit" disabled={!token||busy}>{busy?'Preparing secure checkout…':<>Continue to payment <ArrowRight size={16}/></>}</button><small className="terms-note">By continuing, you agree to the store’s terms and privacy policy.</small>
    </form>
    <aside className="checkout-summary"><div className="summary-title"><h2>Order summary</h2><span>{lines.reduce((n,p)=>n+p.quantity,0)} items</span></div><div className="summary-products">{lines.map(p=><div className="summary-product" key={p.id}><div className={'summary-image '+p.color} style={{backgroundImage:`url(${getImgUrl(p.img)})`}}/><div className="summary-product-text"><small>{p.brand}</small><b>{p.name}</b><div className="summary-qty"><button type="button" aria-label="Decrease quantity" onClick={()=>onQty(p.cartKey,-1)}><Minus size={12}/></button><span>{p.quantity}</span><button type="button" aria-label="Increase quantity" onClick={()=>onQty(p.cartKey,1)}><Plus size={12}/></button></div></div><strong>{money(p.price*p.quantity)}</strong></div>)}</div>
      <form className="coupon-form checkout-coupon" onSubmit={e=>{e.preventDefault();setCouponApplied(coupon.trim().toUpperCase()==='DUKAAN10');setError(coupon.trim().toUpperCase()==='DUKAAN10'?'':'Use code DUKAAN10 for the demo welcome offer.')}}><input aria-label="Discount code" placeholder="Discount code" value={coupon} onChange={e=>setCoupon(e.target.value)}/><button>Apply</button></form>{couponApplied&&<small className="coupon-success">DUKAAN10 · 10% welcome discount</small>}
      <div className="summary-total"><div><span>Subtotal</span><b>{money(subtotal)}</b></div>{discount>0&&<div><span>Discount</span><b>−{money(discount)}</b></div>}<div><span>Delivery</span><b>{shippingFee===0?'Free':money(shippingFee)}</b></div><div className="grand-total"><span>Total <small>INR · estimated</small></span><b>{money(subtotal-discount+shippingFee)}</b></div></div><div className="checkout-assurance"><Check size={14}/> {subtotal>=5000?'Free delivery applied':'Free delivery over ₹5,000'}<span>Order tracking</span></div></aside></div>
  </main>;
}
