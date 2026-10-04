/* CUSTOMIZE: business settings and products live here */
const CONFIG = {
  name: "NovaLink",
  tagline: "Virtual numbers, social accounts & followers boosting",
  currency: "\u20A6",
  whatsapp: "",                 // e.g. "https://wa.me/234XXXXXXXXXX"
  paystackPublicKey: "",        // pk_live_xxx. Empty = demo payment (no real money)
  adminEmail: "admin@novalink.com",
  adminPassword: "admin123"     // demo only
};

// type: number | account | boost.   price = per unit (boost: per `per` units)
const PRODUCTS = [
  {id:1,type:"number",platform:"WhatsApp",name:"WhatsApp Verification Number",desc:"One-time SMS code number. Code is sent to your order.",price:1500,per:1,min:1,max:1},
  {id:2,type:"number",platform:"Telegram",name:"Telegram Verification Number",desc:"One-time SMS code number for Telegram.",price:1200,per:1,min:1,max:1},
  {id:3,type:"account",platform:"Instagram",name:"Aged Instagram Account",desc:"Pre-registered account, login details delivered instantly.",price:2000,per:1,min:1,max:10,
    stock:["ig_user1:Pass#101:mail1@example.com","ig_user2:Pass#102:mail2@example.com","ig_user3:Pass#103:mail3@example.com"]},
  {id:4,type:"account",platform:"Facebook",name:"Facebook Account (Verified Email)",desc:"Ready to use, instant delivery.",price:1800,per:1,min:1,max:10,
    stock:["fb_user1:Pass#201:mail4@example.com","fb_user2:Pass#202:mail5@example.com"]},
  {id:5,type:"boost",platform:"Instagram",name:"Instagram Followers (Real)",desc:"Real, active profiles. Gradual delivery. Price per 1000.",price:4500,per:1000,min:100,max:50000},
  {id:6,type:"boost",platform:"TikTok",name:"TikTok Followers (Fast)",desc:"Fast delivery, may drop. Price per 1000.",price:1500,per:1000,min:100,max:100000},
  {id:7,type:"boost",platform:"YouTube",name:"YouTube Views",desc:"High retention views. Price per 1000.",price:3000,per:1000,min:500,max:100000},
  {id:8,type:"boost",platform:"Instagram",name:"Instagram Likes",desc:"Instant likes on your post. Price per 1000.",price:1200,per:1000,min:50,max:20000}
];
const TYPES = {number:"Virtual Numbers",account:"Social Accounts",boost:"Social Boosting"};
