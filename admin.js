import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAJ1SeBgN_jMq1x1QOBBeiqDuIZJp9b050",
  authDomain: "bhakti-decor.firebaseapp.com",
  projectId: "bhakti-decor",
  messagingSenderId: "288159506881",
  appId: "1:288159506881:web:88d66406c064af9ceecf40",
};

const CLOUDINARY_CLOUD_NAME = "dqnrbibhi";
const CLOUDINARY_UPLOAD_PRESET = "bhakti_products";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Global Caches
let productsCache = [];
let categoriesCache = [];
let customersCache = [];
let estimationsCache = [];
let selectedFiles = [];
let existingImages = [];
let pendingDelete = { id: null, type: null };

// Explicitly bind Wizard state arrays to window to prevent module scope ReferenceErrors
window.currentEstProducts = []; 
window.flatEstItems = []; 

// ==========================================
// HELPERS
// ==========================================
function getRandomColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  return "#" + "00000".substring(0, 6 - c.length) + c;
}

function getInitials(name) {
  if (!name) return "?";
  return name.charAt(0).toUpperCase();
}

// Safely formats undefined values so they never break the UI
const safeVal = (val, fallback = '-') => {
    return (val === undefined || val === 'undefined' || val === null || val === '') ? fallback : val;
};

// ==========================================
// AUTHENTICATION
// ==========================================
const loginOverlay = document.getElementById("loginOverlay");
const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginOverlay.style.opacity = "0";
    setTimeout(() => (loginOverlay.style.display = "none"), 1000);
    loadCategories();
    loadCustomers();
    loadProducts();
    loadEstimations();
  } else {
    loginOverlay.style.display = "flex";
    loginBtn.classList.remove("is-loading");
    loginBtn.innerHTML = 'Log In <i class="ti ti-arrow-right"></i>';
    setTimeout(() => (loginOverlay.style.opacity = "1"), 10);
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    document.getElementById("loginError").style.display = "block";
    loginBtn.classList.remove("is-loading");
    loginBtn.innerHTML = 'Log In <i class="ti ti-arrow-right"></i>';
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

// ==========================================
// DASHBOARD & LIST COUNTS
// ==========================================
function updateDashboard() {
  document.getElementById("dashTotalProducts").innerText = productsCache.length;
  document.getElementById("dashActiveProducts").innerText = productsCache.filter((p) => p.isActive).length;
  document.getElementById("dashTotalCustomers").innerText = customersCache.length;
  document.getElementById("dashTotalEstimations").innerText = estimationsCache.length;

  document.getElementById("productsTitle").innerText = `Products (${productsCache.length})`;
  document.getElementById("categoriesTitle").innerText = `Categories (${categoriesCache.length})`;
  document.getElementById("customersTitle").innerText = `Customers (${customersCache.length})`;
  document.getElementById("estimationsTitle").innerText = `Estimations (${estimationsCache.length})`;

  const catCounts = {};
  productsCache.forEach((p) => {
    const cats = p.categories || (p.category ? [p.category] : []);
    cats.forEach(cat => {
        catCounts[cat] = (catCounts[cat] || 0) + 1;
    });
  });

  let statsHtml = "";
  Object.entries(catCounts).forEach(([cat, count]) => {
    const percent = productsCache.length === 0 ? 0 : (count / productsCache.length) * 100;
    statsHtml += `<div class="stat-bar-wrapper"><div class="stat-bar-label"><span>${cat}</span><span>${count} Items</span></div><div class="stat-bar-bg"><div class="stat-bar-fill" style="width: ${percent}%"></div></div></div>`;
  });
  document.getElementById("categoryStatsList").innerHTML = statsHtml || '<p style="color:var(--text-secondary); font-size:13px;">No product data available yet.</p>';

  const recentList = document.getElementById("recentEstimationsList");
  let recentHtml = "";
  const recentEsts = [...estimationsCache].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);

  if (recentEsts.length === 0) {
    recentHtml = '<p style="color:var(--text-secondary); font-size:13px;">No estimations sent yet.</p>';
  } else {
    recentEsts.forEach((e) => {
      recentHtml += `
          <li class="recent-item">
              <div class="recent-info">
                  <h4>${e.customerName}</h4>
                  <p>${new Date(e.date).toLocaleDateString()}</p>
              </div>
              <span class="recent-badge">${e.products.length} Items</span>
          </li>`;
    });
  }
  recentList.innerHTML = recentHtml;
}

function validateForm(formId) {
  const form = document.getElementById(formId);
  let isValid = true;
  form.querySelectorAll("[required]").forEach((input) => {
    const group = input.closest(".form-group, .floating-input, .variant-row");
    if (!input.value.trim()) { group.classList.add("invalid"); isValid = false; } 
    else { group.classList.remove("invalid"); }
  });

  if (formId === "productForm") {
    const imgGroup = document.getElementById("dropZone").closest(".form-group");
    if (selectedFiles.length === 0 && existingImages.length === 0) { imgGroup.classList.add("invalid"); isValid = false; } 
    else { imgGroup.classList.remove("invalid"); }
    
    const catGroup = document.getElementById('productCategoryContainer').closest('.form-group');
    const checkedCats = document.querySelectorAll('input[name="productCategories"]:checked');
    if (checkedCats.length === 0) { catGroup.classList.add('invalid'); isValid = false; } 
    else { catGroup.classList.remove('invalid'); }

    const varsContainer = document.getElementById('variantsContainer');
    const varRows = varsContainer.querySelectorAll('.variant-row');
    if(varRows.length === 0) {
        varsContainer.parentElement.classList.add('invalid'); isValid = false;
    } else {
        varsContainer.parentElement.classList.remove('invalid');
    }
  }

  form.querySelectorAll("input, textarea, select").forEach((input) => {
    input.addEventListener("input", () => {
        const p = input.closest(".form-group, .floating-input, .variant-row");
        if(p) p.classList.remove("invalid");
    }, { once: true });
  });
  return isValid;
}

// ==========================================
// DYNAMIC VARIANT BUILDER
// ==========================================
window.addVariantRow = (size='', moq='', pkg='', cost='', india='', exp='') => {
    const container = document.getElementById('variantsContainer');
    const div = document.createElement('div');
    div.className = 'variant-row';
    div.style.gridTemplateColumns = "2fr 1fr 1fr 1fr 1fr 1fr 44px"; 
    div.innerHTML = `
        <div><label>Size / Variant</label><input type="text" class="v-size" value="${size}" required></div>
        <div><label>MOQ</label><input type="number" class="v-moq" value="${moq}" required></div>
        <div><label>Pkg Qty</label><input type="text" class="v-pkg" value="${pkg}" required></div>
        <div><label>Cost (₹)</label><input type="number" class="v-cost" value="${cost}" required></div>
        <div><label>India (₹)</label><input type="number" class="v-india" value="${india}" required></div>
        <div><label>Export ($)</label><input type="number" step="0.01" class="v-export" value="${exp}" required></div>
        <button type="button" class="del-btn" onclick="this.parentElement.remove()"><i class="ti ti-trash"></i></button>
    `;
    container.appendChild(div);
};

// ==========================================
// CUSTOMER MODULE
// ==========================================
async function loadCustomers() {
  const list = document.getElementById("customerList");
  const estDropdown = document.getElementById("estCustomerSelect");
  const filterDropdown = document.getElementById("filterEstCustomer");

  try {
    const snapshot = await getDocs(collection(db, "customers"));
    customersCache = [];

    if (snapshot.empty) {
      list.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-users"></i><p>No customers found.</p></div></td></tr>`;
      estDropdown.innerHTML = '<option value="" disabled selected>No customers...</option>';
      filterDropdown.innerHTML = '<option value="ALL">All Customers</option>';
      updateDashboard(); return;
    }

    estDropdown.innerHTML = '<option value="" disabled selected>Select customer...</option>';
    filterDropdown.innerHTML = '<option value="ALL">All Customers</option>';

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      data.id = docSnap.id;
      customersCache.push(data);
      estDropdown.innerHTML += `<option value="${data.id}">${data.companyName}</option>`;
      filterDropdown.innerHTML += `<option value="${data.id}">${data.companyName}</option>`;
    });

    renderCustomerTable();
    updateDashboard();
  } catch (e) {
    list.innerHTML = '<tr><td colspan="4" style="color:#fca5a5; text-align:center;">Failed to load.</td></tr>';
  }
}

function renderCustomerTable() {
  const list = document.getElementById("customerList");
  list.innerHTML = "";
  customersCache.forEach((data) => {
    const bgColor = getRandomColor(data.companyName);
    const initial = getInitials(data.companyName);
    list.innerHTML += `
        <tr>
            <td>
                <div class="customer-cell">
                    <div class="avatar-circle" style="background-color: ${bgColor};">${initial}</div>
                    <span style="font-weight: 500; color: white;">${data.companyName}</span>
                </div>
            </td>
            <td style="color:var(--text-secondary);">${safeVal(data.contactPerson)}</td>
            <td style="color:var(--text-secondary);">${safeVal(data.phone)}</td>
            <td>
                <div class="actions-cell">
                    <button class="action-icon" onclick="window.viewCustomer('${data.id}')"><i class="ti ti-eye"></i></button>
                    <button class="action-icon" onclick="window.editCustomer('${data.id}')"><i class="ti ti-pencil"></i></button>
                    <button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'customers')"><i class="ti ti-trash"></i></button>
                </div>
            </td>
        </tr>`;
  });
}

document.getElementById("customerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateForm("customerForm")) return;

    const btn = document.getElementById("custSubmitBtn");
    const id = document.getElementById("customerId").value;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Saving...';
    btn.disabled = true;

    const data = {
      companyName: document.getElementById("custCompany").value,
      contactPerson: document.getElementById("custContact").value,
      emails: document.getElementById("custEmails").value,
      phone: document.getElementById("custPhone").value,
      country: document.getElementById("custCountry").value,
      website: document.getElementById("custWebsite").value,
      address: document.getElementById("custAddress").value,
      notes: document.getElementById("custNotes").value,
    };

    try {
      if (id) await updateDoc(doc(db, "customers", id), data);
      else {
        data.createdAt = new Date().toISOString();
        await addDoc(collection(db, "customers"), data);
      }
      document.getElementById("customerForm").reset();
      loadCustomers();
      document.querySelectorAll(".nav-btn")[4].click();
    } catch (err) {
      alert("Error saving customer.");
    } finally {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  });

window.viewCustomer = (id) => {
  const c = customersCache.find((x) => x.id === id);
  if (!c) return;

  const bgColor = getRandomColor(c.companyName);
  const initial = getInitials(c.companyName);

  document.getElementById("viewCustomerBody").innerHTML = `
        <div style="display:flex; align-items:center; gap:20px; margin-bottom: 30px; border-bottom: 1px solid var(--glass-border); padding-bottom: 30px;">
            <div class="avatar-circle" style="background-color: ${bgColor}; width: 64px; height: 64px; font-size: 28px;">${initial}</div>
            <div>
                <h2 style="font-family:'Bricolage Grotesque', sans-serif; font-size:28px; font-weight:400; color:var(--text-primary); margin-bottom:4px;">${c.companyName}</h2>
                <span style="color:var(--text-secondary); font-size:13px; text-transform:uppercase; letter-spacing:1px;">Client Profile</span>
            </div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px;">
            <div class="detail-block"><h4>Contact Person</h4><p style="color:white;">${safeVal(c.contactPerson)}</p></div>
            <div class="detail-block"><h4>Emails</h4><p style="color:white;">${safeVal(c.emails)}</p></div>
            <div class="detail-block"><h4>Phone</h4><p style="color:white;">${safeVal(c.phone)}</p></div>
            <div class="detail-block"><h4>Country</h4><p style="color:white;">${safeVal(c.country)}</p></div>
            <div class="detail-block" style="grid-column: 1 / -1;"><h4>Website</h4><p style="color:white;">${safeVal(c.website)}</p></div>
            <div class="detail-block" style="grid-column: 1 / -1;"><h4>Full Address</h4><p style="color:white;">${safeVal(c.address)}</p></div>
            <div class="detail-block" style="grid-column: 1 / -1;"><h4>Internal Notes</h4><p style="color:white;">${safeVal(c.notes)}</p></div>
        </div>
    `;
  document.getElementById("viewCustomerModal").classList.add("active");
};

window.editCustomer = (id) => {
  const c = customersCache.find((x) => x.id === id);
  if (!c) return;
  document.getElementById("custFormTitle").innerText = "Edit Customer";
  document.getElementById("custSubmitBtn").innerHTML = 'Update Customer <i class="ti ti-check"></i>';
  document.getElementById("customerId").value = c.id;
  document.getElementById("custCompany").value = c.companyName || "";
  document.getElementById("custContact").value = c.contactPerson || "";
  document.getElementById("custEmails").value = c.emails || "";
  document.getElementById("custPhone").value = c.phone || "";
  document.getElementById("custCountry").value = c.country || "";
  document.getElementById("custWebsite").value = c.website || "";
  document.getElementById("custAddress").value = c.address || "";
  document.getElementById("custNotes").value = c.notes || "";

  document.querySelectorAll(".section").forEach((sec) => sec.classList.remove("active"));
  document.getElementById("addCustomer").classList.add("active");
};

// ==========================================
// CATEGORY MANAGEMENT
// ==========================================
async function loadCategories() {
  const list = document.getElementById("categoryList");
  const filterDropdown = document.getElementById("filterProductCat");
  const multiCatContainer = document.getElementById("productCategoryContainer");

  try {
    const snapshot = await getDocs(collection(db, "categories"));
    list.innerHTML = "";
    filterDropdown.innerHTML = '<option value="ALL">All Categories</option>';
    multiCatContainer.innerHTML = '';
    categoriesCache = [];

    if (snapshot.empty) {
      list.innerHTML = `<tr><td colspan="3"><div class="empty-state"><p>No categories found.</p></div></td></tr>`;
      updateDashboard();
      return;
    }

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      data.id = docSnap.id;
      categoriesCache.push(data);
      if (data.isActive) {
        filterDropdown.innerHTML += `<option value="${data.name}">${data.name}</option>`;
        multiCatContainer.innerHTML += `
            <label class="cat-pill-label">
                <input type="checkbox" name="productCategories" value="${data.name}">
                <div class="cat-pill">${data.name}</div>
            </label>
        `;
      }

      const statusBadge = data.isActive ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>';
      list.innerHTML += `<tr><td style="color: white;">${data.name}</td><td><div class="status-cell"><label class="switch"><input type="checkbox" onchange="window.toggleCategory('${data.id}', ${data.isActive})" ${data.isActive ? "checked" : ""}><span class="slider"></span></label>${statusBadge}</div></td><td><div class="actions-cell"><button class="action-icon" onclick="window.editCategory('${data.id}')"><i class="ti ti-pencil"></i></button><button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'categories')"><i class="ti ti-trash"></i></button></div></td></tr>`;
    });
    updateDashboard();
  } catch (error) {
    list.innerHTML = '<tr><td colspan="3" style="color:#fca5a5;">Failed to load.</td></tr>';
  }
}

document.getElementById("categoryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateForm("categoryForm")) return;
    const btn = document.getElementById("catSubmitBtn");
    const id = document.getElementById("categoryId").value;
    const name = document.getElementById("categoryName").value.trim();
    btn.innerHTML = '<i class="ti ti-loader ti-spin"></i>';
    btn.disabled = true;
    try {
      if (id) await updateDoc(doc(db, "categories", id), { name });
      else await addDoc(collection(db, "categories"), { name, isActive: true, createdAt: new Date().toISOString() });
      document.getElementById("catModal").classList.remove("active");
      loadCategories();
    } catch (error) {
      alert("Error saving.");
    } finally {
      btn.innerHTML = "Save Category";
      btn.disabled = false;
    }
  });
window.editCategory = (id) => {
  const cat = categoriesCache.find((c) => c.id === id);
  if (!cat) return;
  document.getElementById("categoryId").value = cat.id;
  document.getElementById("categoryName").value = cat.name;
  document.getElementById("catModalTitle").innerText = "Edit Category";
  document.getElementById("catModal").classList.add("active");
};
window.toggleCategory = async (id, status) => {
  await updateDoc(doc(db, "categories", id), { isActive: !status });
  loadCategories();
};

// ==========================================
// PRODUCT MANAGEMENT & FILTERING
// ==========================================
window.filterProductList = () => {
  const filter = document.getElementById("filterProductCat").value;
  renderProductsTable(filter);
};

function renderProductsTable(filterCat = "ALL") {
  const list = document.getElementById("productList");
  list.innerHTML = "";

  let filtered = productsCache;
  if (filterCat !== "ALL") {
    filtered = productsCache.filter((p) => p.categories && p.categories.includes(filterCat));
  }

  if (filtered.length === 0) {
    list.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="ti ti-shopping-bag-x"></i><p>No products match this filter.</p></div></td></tr>`;
    return;
  }

  filtered.forEach((data) => {
    const imgUrl = data.images && data.images.length > 0 ? data.images[0] : "";
    const statusBadge = data.isActive ? '<span class="badge badge-active">Publish</span>' : '<span class="badge badge-inactive">Inactive</span>';
    const cats = data.categories || (data.category ? [data.category] : []);
    const catBadges = cats.map(c => `<span class="badge" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #d4d4d8; margin-right: 4px; display:inline-block; margin-bottom: 4px;">${c}</span>`).join('');
    
    const variants = data.pricing || [{india: data.priceIndia}];
    const prices = variants.map(v => Number(v.india) || 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const priceDisplay = variants.length > 1 ? `From ₹${minPrice}` : `₹${minPrice}`;

    list.innerHTML += `<tr><td><div class="product-cell">${imgUrl ? `<img src="${imgUrl}" class="img-thumb">` : `<div class="img-thumb" style="display:flex; justify-content:center; align-items:center;"><i class="ti ti-photo-off"></i></div>`}<div class="product-info"><span class="product-title">${data.name}</span><p class="product-desc-text">${data.description || "No description"}</p></div></div></td><td style="max-width:200px;">${catBadges}</td><td style="font-weight: 500; font-size: 14px; color: white;">${priceDisplay}</td><td><div class="status-cell"><label class="switch"><input type="checkbox" onchange="window.toggleProduct('${data.id}', ${data.isActive})" ${data.isActive ? "checked" : ""}><span class="slider"></span></label>${statusBadge}</div></td><td><div class="actions-cell"><button class="action-icon" onclick="window.viewProduct('${data.id}')"><i class="ti ti-eye"></i></button><button class="action-icon" onclick="window.editProduct('${data.id}')"><i class="ti ti-pencil"></i></button><button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'products')"><i class="ti ti-trash"></i></button></div></td></tr>`;
  });
}

async function loadProducts() {
  try {
    const querySnapshot = await getDocs(collection(db, "products"));
    productsCache = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      data.id = docSnap.id;
      if(!data.categories && data.category) data.categories = [data.category]; // Retrofit old data
      productsCache.push(data);
    });
    renderProductsTable();
    updateDashboard();
  } catch (error) {}
}

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("productImages");
const previewContainer = document.getElementById("imagePreviews");
dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => handleFiles(e.target.files));
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); handleFiles(e.dataTransfer.files); });
window.addEventListener("clearImages", () => { selectedFiles = []; existingImages = []; renderPreviews(); });

function handleFiles(files) {
  selectedFiles = [...selectedFiles, ...Array.from(files)];
  fileInput.value = ""; document.getElementById("dropZone").closest(".form-group").classList.remove("invalid"); renderPreviews();
}

function renderPreviews() {
  previewContainer.innerHTML = "";
  existingImages.forEach((url, index) => {
    previewContainer.innerHTML += `<div class="preview-item"><img src="${url}"><button type="button" class="remove-btn" onclick="window.removeExistingImage(${index})"><i class="ti ti-x"></i></button></div>`;
  });
  selectedFiles.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = (e) => { previewContainer.innerHTML += `<div class="preview-item"><img src="${e.target.result}"><button type="button" class="remove-btn" onclick="window.removeLocalFile(${index})"><i class="ti ti-x"></i></button></div>`; };
    reader.readAsDataURL(file);
  });
}
window.removeLocalFile = (index) => { selectedFiles.splice(index, 1); renderPreviews(); };
window.removeExistingImage = (index) => { existingImages.splice(index, 1); renderPreviews(); };

async function uploadToCloudinary(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  return (await res.json()).secure_url;
}

productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateForm("productForm")) return;
  
  const btn = document.getElementById("submitBtn");
  const editId = document.getElementById("productId").value;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Saving...';
  btn.disabled = true;

  try {
    let finalImageUrls = [...existingImages];
    for (let i = 0; i < selectedFiles.length; i++) finalImageUrls.push(await uploadToCloudinary(selectedFiles[i]));
    
    const kw = document.getElementById("seoKeywords").value.split(",").map((k) => k.trim()).filter((k) => k !== "");
    const selectedCats = Array.from(document.querySelectorAll('input[name="productCategories"]:checked')).map(cb => cb.value);

    const pricingArray = [];
    document.querySelectorAll('.variant-row').forEach(row => {
        pricingArray.push({
            size: row.querySelector('.v-size').value,
            moq: row.querySelector('.v-moq').value,
            qtyInPackage: row.querySelector('.v-pkg').value,
            cost: Number(row.querySelector('.v-cost').value),
            india: Number(row.querySelector('.v-india').value),
            export: Number(row.querySelector('.v-export').value)
        });
    });

    const data = {
      name: document.getElementById("productName").value,
      categories: selectedCats,
      description: document.getElementById("productDesc").value,
      pricing: pricingArray,
      hsCode: document.getElementById("hsCode").value,
      gsm: document.getElementById("gsm").value,
      seoKeywords: kw,
      images: finalImageUrls,
    };

    if (editId) await updateDoc(doc(db, "products", editId), data);
    else { data.isActive = true; data.createdAt = new Date().toISOString(); await addDoc(collection(db, "products"), data); }
    
    productForm.reset();
    document.getElementById("productId").value = "";
    window.dispatchEvent(new Event("clearImages"));
    loadProducts();
    document.querySelectorAll(".nav-btn")[2].click();
  } catch (error) {
    alert("Failed to save product.");
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
});

window.toggleProduct = async (id, status) => {
  await updateDoc(doc(db, "products", id), { isActive: !status });
  loadProducts();
};

// ==========================================
// MATCHING PRODUCT DETAILS (6.10.44 PM)
// ==========================================
window.viewProduct = (id) => {
  const p = productsCache.find((x) => x.id === id);
  if (!p) return;
  
  let thumbsHtml = "";
  if (p.images) {
      p.images.forEach((img) => {
          thumbsHtml += `<img src="${img}">`;
      });
  }

  const cats = p.categories || (p.category ? [p.category] : []);
  const catHtml = cats.join(' &nbsp;•&nbsp; ');

  const variants = p.pricing || [{size: p.sizeDetails||'Standard', moq: p.moq||'', qtyInPackage: p.qtyInPackage||'', cost: p.mfgCost, india: p.priceIndia, export: p.priceExport}];
  
  let pricingHtml = `<table class="modal-pricing-table"><thead><tr><th>Size</th><th>Cost</th><th>India</th><th>Export</th></tr></thead><tbody>`;
  variants.forEach(v => { 
      pricingHtml += `<tr>
          <td style="color:white;">${safeVal(v.size)}</td>
          <td style="color:white;">₹${safeVal(v.cost)}</td>
          <td style="color:white;">₹${safeVal(v.india)}</td>
          <td style="color:white;">$${safeVal(v.export)}</td>
      </tr>`; 
  });
  pricingHtml += `</tbody></table>`;

  document.getElementById("viewModalBody").innerHTML = `
    <div class="view-layout">
        <div class="view-left-bar">
            ${thumbsHtml}
        </div>
        <div class="view-right-content">
            <span class="modal-cat">${catHtml}</span>
            <h2 class="modal-title">${p.name}</h2>
            ${pricingHtml}
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom: 24px; border-top:1px solid var(--glass-border); padding-top:24px;">
                <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; margin-bottom:4px;">HS Code</h4><p style="color:white; font-size:13px; margin:0;">${safeVal(p.hsCode)}</p></div>
                <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; margin-bottom:4px;">Default MOQ</h4><p style="color:white; font-size:13px; margin:0;">${safeVal(p.moq || variants[0].moq)}</p></div>
                <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; margin-bottom:4px;">GSM</h4><p style="color:white; font-size:13px; margin:0;">${safeVal(p.gsm)}</p></div>
                <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; margin-bottom:4px;">Package Qty</h4><p style="color:white; font-size:13px; margin:0;">${safeVal(p.qtyInPackage || variants[0].qtyInPackage)}</p></div>
            </div>
            <div class="detail-block"><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; margin-bottom:8px;">Description</h4><p style="color:#d4d4d8;">${safeVal(p.description)}</p></div>
        </div>
    </div>`;
  document.getElementById("viewModal").classList.add("active");
};

window.editProduct = (id) => {
  const p = productsCache.find((x) => x.id === id);
  if (!p) return;
  document.getElementById("formTitle").innerText = "Edit Product";
  document.getElementById("submitBtn").innerHTML = 'Update Product <i class="ti ti-check"></i>';
  document.getElementById("productId").value = p.id;
  document.getElementById("productName").value = p.name;
  document.getElementById("hsCode").value = p.hsCode || "";
  document.getElementById("gsm").value = p.gsm || "";
  document.getElementById("seoKeywords").value = p.seoKeywords ? p.seoKeywords.join(", ") : "";
  document.getElementById("productDesc").value = p.description;

  document.querySelectorAll('input[name="productCategories"]').forEach(cb => cb.checked = false);
  const catsToSelect = p.categories || (p.category ? [p.category] : []);
  catsToSelect.forEach(c => { const cb = document.querySelector(`input[name="productCategories"][value="${c}"]`); if(cb) cb.checked = true; });

  const varsContainer = document.getElementById('variantsContainer');
  varsContainer.innerHTML = '';
  const variants = p.pricing || [{size: p.sizeDetails||'', moq: p.moq||'', qtyInPackage: p.qtyInPackage||'', cost: p.mfgCost, india: p.priceIndia, export: p.priceExport}];
  variants.forEach(v => window.addVariantRow(v.size, v.moq, v.qtyInPackage, v.cost, v.india, v.export));

  existingImages = p.images || []; selectedFiles = []; renderPreviews();
  document.querySelectorAll(".form-group, .floating-input").forEach((el) => el.classList.remove("invalid"));
  document.querySelectorAll(".section").forEach((sec) => sec.classList.remove("active"));
  document.getElementById("addProduct").classList.add("active");
};

// ==========================================
// ESTIMATION WIZARD, EXPORT & PRINT
// ==========================================
window.filterEstimationList = () => {
  const filterId = document.getElementById("filterEstCustomer").value;
  renderEstimationsTable(filterId);
};

function renderEstimationsTable(custId = "ALL") {
  const list = document.getElementById("estimationList");
  list.innerHTML = "";

  let filtered = estimationsCache;
  if (custId !== "ALL") {
    filtered = estimationsCache.filter((e) => e.customerId === custId);
  }

  if (filtered.length === 0) {
    list.innerHTML = `<tr><td colspan="4"><div class="empty-state"><p>No estimations found.</p></div></td></tr>`;
    return;
  }

  filtered.forEach((data) => {
    const d = new Date(data.date).toLocaleDateString();
    list.innerHTML += `
            <tr>
                <td style="color:var(--text-secondary);">${d}</td>
                <td style="color:white; font-weight:500;">${data.customerName}</td>
                <td style="color:white;">${data.products.length} Items</td>
                <td>
                    <div class="actions-cell">
                        <button class="action-icon" onclick="exportToExcel('${data.id}')" title="Export CSV"><i class="ti ti-file-spreadsheet"></i></button>
                        <button class="action-icon" onclick="printEstimation('${data.id}')" title="Print/Download PDF"><i class="ti ti-printer"></i></button>
                        <button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'estimations')"><i class="ti ti-trash"></i></button>
                    </div>
                </td>
            </tr>`;
  });
}

async function loadEstimations() {
  try {
    const snapshot = await getDocs(collection(db, "estimations"));
    estimationsCache = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      data.id = docSnap.id;
      estimationsCache.push(data);
    });
    renderEstimationsTable();
    updateDashboard();
  } catch (e) {}
}

window.openCreateEstimation = () => {
  document.getElementById("estCustomerSelect").value = "";
  document.getElementById("estSearchProduct").value = "";
  document.getElementById("estPriceType").value = "export";
  document.getElementById("estCustError").style.display = "none";
  window.currentEstProducts = [];
  renderEstProductSelection();

  document.getElementById("step1-ind").classList.add("active");
  document.getElementById("step2-ind").classList.remove("active");
  document.getElementById("estStep1").classList.add("active");
  document.getElementById("estStep2").classList.remove("active");

  document.querySelectorAll(".section").forEach((sec) => sec.classList.remove("active"));
  document.getElementById("createEstimation").classList.add("active");
};

function renderEstProductSelection(filterText = "") {
  const list = document.getElementById("estProductSelectionList");
  list.innerHTML = "";
  const filtered = productsCache.filter(
    (p) => p.isActive && p.name.toLowerCase().includes(filterText.toLowerCase())
  );

  filtered.forEach((p) => {
    const img = p.images && p.images.length > 0 ? p.images[0] : "https://via.placeholder.com/50";
    const isSelected = window.currentEstProducts.find((cp) => cp.id === p.id) ? "checked" : "";
    const cardClass = isSelected ? "selectable-card selected" : "selectable-card";
    
    const variants = p.pricing || [{export: p.priceExport}];
    const minPrice = variants.length > 0 ? Math.min(...variants.map(v => Number(v.export)||0)) : 0;

    list.innerHTML += `
            <label class="${cardClass}">
                <input type="checkbox" value="${p.id}" ${isSelected} onchange="toggleEstProduct(this, '${p.id}')">
                <img src="${img}">
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:500; font-size:13px; color:white;">${p.name}</span>
                    <span style="font-size:11px; color:var(--text-secondary);">From $${minPrice}</span>
                </div>
            </label>
        `;
  });
}

window.filterEstProducts = () => {
  renderEstProductSelection(document.getElementById("estSearchProduct").value);
};

window.toggleEstProduct = (checkbox, id) => {
  const card = checkbox.closest(".selectable-card");
  if (checkbox.checked) {
    card.classList.add("selected");
    const p = productsCache.find((x) => x.id === id);
    window.currentEstProducts.push({ ...p });
  } else {
    card.classList.remove("selected");
    window.currentEstProducts = window.currentEstProducts.filter((x) => x.id !== id);
  }
};

// MATCHING WIZARD STEP 2 (6.34.49 PM)
window.goToEstStep2 = () => {
  if (!document.getElementById("estCustomerSelect").value) {
    document.getElementById("estCustError").style.display = "block";
    return;
  }
  if (window.currentEstProducts.length === 0) {
    alert("Please select at least one product.");
    return;
  }

  window.estPriceType = document.getElementById('estPriceType').value;
  const currencySymbol = window.estPriceType === 'export' ? '$' : '₹';

  document.getElementById("estCustError").style.display = "none";
  document.getElementById("step1-ind").classList.remove("active");
  document.getElementById("step2-ind").classList.add("active");
  document.getElementById("estStep1").classList.remove("active");
  document.getElementById("estStep2").classList.add("active");

  const container = document.getElementById("estEditableListContainer");
  container.innerHTML = "";
  
  window.flatEstItems = [];
  let rowIndex = 0;

  window.currentEstProducts.forEach((p) => {
    const variants = (p.pricing && p.pricing.length > 0) ? p.pricing : [{size: p.sizeDetails||'Standard', moq: p.moq||'', qtyInPackage: p.qtyInPackage||'', cost: p.mfgCost||'', india: p.priceIndia||'', export: p.priceExport||''}];
    
    let variantHtml = '';
    variants.forEach(v => {
        const priceVal = window.estPriceType === 'export' ? (v.export || p.priceExport || '') : (v.india || p.priceIndia || '');
        const vMoq = v.moq || p.moq || '';
        const vQty = v.qtyInPackage || p.qtyInPackage || '';
        const vSize = v.size || 'Standard';

        window.flatEstItems.push({
            ...p,
            variantSize: vSize,
            defaultMoq: vMoq,
            defaultPkg: vQty,
            defaultPrice: priceVal,
            rowIndex: rowIndex
        });
        
        variantHtml += `
            <div id="estRow_${rowIndex}" class="est-variant-row">
                <span style="color:white; font-size:12px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${vSize}</span>
                
                <div style="display:flex; align-items:center; background:rgba(0,0,0,0.3); border-radius:6px; padding: 0 12px; border:1px solid var(--glass-border);">
                    <span style="font-size:10px; color:var(--text-secondary); margin-right:8px;">MOQ</span>
                    <input type="number" id="estMoq_${rowIndex}" value="${vMoq}" style="width:100%; color:white; border:none; padding:10px 0; background:transparent;">
                </div>
                
                <div style="display:flex; align-items:center; background:rgba(0,0,0,0.3); border-radius:6px; padding: 0 12px; border:1px solid var(--glass-border);">
                    <input type="text" id="estQty_${rowIndex}" value="${vQty}" style="width:100%; color:white; border:none; padding:10px 0; background:transparent;" placeholder="Pkg Qty">
                </div>
                
                <div style="display:flex; align-items:center; background:rgba(0,0,0,0.3); border-radius:6px; padding: 0 12px; border:1px solid var(--glass-border);">
                    <span style="color:var(--text-secondary); margin-right:4px;">${currencySymbol}</span>
                    <input type="number" step="0.01" id="estPrice_${rowIndex}" value="${priceVal}" style="width:100%; color:white; border:none; padding:10px 0; background:transparent;">
                </div>
                
                <button type="button" class="action-icon delete" onclick="removeEstRow(${rowIndex})" style="width:32px; height:32px; flex-shrink:0;"><i class="ti ti-trash"></i></button>
            </div>
        `;
        rowIndex++;
    });

    container.innerHTML += `
        <div class="est-split-layout">
            <div class="est-split-left">
                <h3>${p.name || ''}</h3>
                <p style="font-size:11px; color:var(--text-secondary); margin-top:4px;">HS: ${p.hsCode || '-'} | GSM: ${p.gsm || '-'}</p>
            </div>
            <div class="est-split-right">
                ${variantHtml}
            </div>
        </div>
    `;
  });
};

window.removeEstRow = (index) => {
    document.getElementById(`estRow_${index}`).style.display = 'none';
    const item = window.flatEstItems.find(x => x.rowIndex === index);
    if(item) item.deleted = true;
};

window.backToEstStep1 = () => {
  document.getElementById("step2-ind").classList.remove("active");
  document.getElementById("step1-ind").classList.add("active");
  document.getElementById("estStep2").classList.remove("active");
  document.getElementById("estStep1").classList.add("active");
};

window.saveEstimation = async () => {
  const btn = document.getElementById("saveEstBtn");
  btn.innerHTML = '<i class="ti ti-loader ti-spin"></i>';
  btn.disabled = true;

  const finalItems = [];
  window.flatEstItems.forEach(item => {
      if(!item.deleted) {
          const moqEl = document.getElementById(`estMoq_${item.rowIndex}`);
          const qtyEl = document.getElementById(`estQty_${item.rowIndex}`);
          const priceEl = document.getElementById(`estPrice_${item.rowIndex}`);

          finalItems.push({
              name: item.name || "",
              description: item.description || "",
              hsCode: item.hsCode || "",
              gsm: item.gsm || "",
              sizeDetails: item.sizeDetails || "",
              images: item.images || [],
              categories: item.categories || (item.category ? [item.category] : []),
              variantSize: item.variantSize || "Standard",
              estMoq: moqEl ? moqEl.value : "",
              estQtyInPackage: qtyEl ? qtyEl.value : "",
              estPrice: priceEl ? priceEl.value : ""
          });
      }
  });

  if(finalItems.length === 0) {
      alert("Cannot save an empty estimation. Please select at least one product size.");
      btn.innerHTML = 'Save & Generate <i class="ti ti-file-invoice"></i>'; btn.disabled = false;
      return;
  }

  const custId = document.getElementById("estCustomerSelect").value;
  const cust = customersCache.find((c) => c.id === custId);
  
  if (!cust) {
      alert("Invalid customer selected.");
      btn.innerHTML = 'Save & Generate <i class="ti ti-file-invoice"></i>'; btn.disabled = false;
      return;
  }

  const estData = {
    customerId: cust.id || "",
    customerName: cust.companyName || "",
    date: new Date().toISOString(),
    priceType: window.estPriceType || "export",
    products: finalItems,
  };

  try {
    const docRef = await addDoc(collection(db, "estimations"), estData);
    loadEstimations();
    document.querySelectorAll(".nav-btn")[1].click();
    printEstimation(docRef.id);
  } catch (err) {
    console.error("Firebase AddDoc Error:", err);
    alert("Error saving estimation.");
  } finally {
    btn.innerHTML = 'Save & Generate <i class="ti ti-file-invoice"></i>';
    btn.disabled = false;
  }
};

window.exportToExcel = (id) => {
    const est = estimationsCache.find((e) => e.id === id);
    if (!est) return;

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Product Name,HS Code,GSM,Variant Size,MOQ,Package Qty,Price\n";

    est.products.forEach(p => {
        const name = `"${safeVal(p.name).replace(/"/g, '""')}"`;
        const hs = `"${safeVal(p.hsCode).replace(/"/g, '""')}"`;
        const gsm = `"${safeVal(p.gsm).replace(/"/g, '""')}"`;
        const size = `"${safeVal(p.variantSize).replace(/"/g, '""')}"`;
        const qty = `"${safeVal(p.estQtyInPackage).replace(/"/g, '""')}"`;
        csvContent += `${name},${hs},${gsm},${size},${safeVal(p.estMoq)},${qty},${safeVal(p.estPrice)}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Estimation_${est.customerName.replace(/\s+/g, '_')}_${new Date().getTime()}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ==========================================
// REDESIGNED PRINT ENGINE (6.07.44 PM layout)
// ==========================================
window.printEstimation = (id) => {
  const est = estimationsCache.find((e) => e.id === id);
  if (!est) return;

  const cust = customersCache.find((c) => c.id === est.customerId);
  const company = cust ? cust.companyName : est.customerName;
  const contact = cust && cust.contactPerson ? cust.contactPerson : "";
  const phone = cust && cust.phone ? cust.phone : "";
  const address = cust && cust.address ? cust.address : "";

  const isExport = est.priceType === 'export';
  const currencySymbol = isExport ? '$' : '₹';
  const priceLabel = isExport ? 'PRICE (EXPORT)' : 'PRICE (INDIA)';

  // Group variants under products for cleaner printing
  const groupedProducts = {};
  est.products.forEach(p => {
      if(!groupedProducts[p.name]) groupedProducts[p.name] = { ...p, variants: [] };
      groupedProducts[p.name].variants.push({ size: p.variantSize, moq: p.estMoq, qty: p.estQtyInPackage, price: p.estPrice });
  });

  let rowsHtml = "";
  let index = 1;
  
  Object.values(groupedProducts).forEach((p) => {
    let imagesGrid = "";
    if (p.images && p.images.length > 0) {
      const imagesToShow = p.images.slice(0, 3); 
      imagesToShow.forEach((img) => { imagesGrid += `<img src="${img}" class="product-img">`; });
    }
    const printCats = p.categories || (p.category ? [p.category] : []);
    
    let variantRows = "";
    p.variants.forEach((v, vIndex) => {
        const isFirst = vIndex === 0;
        variantRows += `
            <tr>
                ${isFirst ? `<td rowspan="${p.variants.length}" class="col-index">${String(index).padStart(2, "0")}</td>` : ''}
                ${isFirst ? `<td rowspan="${p.variants.length}" class="col-img"><div class="img-wrapper">${imagesGrid}</div></td>` : ''}
                ${isFirst ? `<td rowspan="${p.variants.length}" class="col-details">
                    <div class="product-name">${p.name} <span style="font-weight:400; font-size:10px; color:#52525b; margin-left:6px;">${printCats.join(', ')}</span></div>
                    <div class="product-meta"><span class="meta-pill">HS CODE: ${safeVal(p.hsCode)}</span><span class="meta-pill">GSM: ${safeVal(p.gsm)}</span></div>
                </td>` : ''}
                <td class="col-variant-size" style="${!isFirst ? 'border-left: 1px solid #e4e4e7;' : ''}">${safeVal(v.size)}</td>
                <td class="col-qty">${safeVal(v.qty)}</td>
                <td class="col-moq">${safeVal(v.moq)}</td>
                <td class="col-price">${currencySymbol}${safeVal(v.price)}</td>
            </tr>
        `;
    });
    rowsHtml += variantRows;
    index++;
  });

  const printContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Estimate - ${company}</title>
            <style>
                :root { --text-main: #000000; --text-muted: #52525b; --border-color: #e4e4e7; --bg-soft: #f4f4f5; }
                * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                body { font-family: 'Inter', sans-serif; color: var(--text-main); margin: 0; padding: 40px; font-size: 11px; line-height: 1.5; background: #fff; }
                @page { size: A4 landscape; margin: 10mm; }
                .document-wrapper { display: flex; flex-direction: column; min-height: 90vh; }
                
                .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; border-bottom: 2px solid #000; margin-bottom: 32px; }
                .logo-text { font-family: 'Bricolage Grotesque', sans-serif; font-size: 42px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; line-height: 1; margin: 0; }
                .c-b { color: #2e3192; } .c-h { color: #8cc63f; } .c-a { color: #f15a24; } .c-k { color: #f7931e; } .c-t { color: #009245; } .c-i { color: #1c75bc; }
                .sender-info { text-align: right; }
                .sender-info h3 { font-family: 'Bricolage Grotesque', sans-serif; font-size: 16px; margin: 0 0 4px 0; color: #000; letter-spacing: 1px; text-transform: uppercase; }
                .sender-info p { margin: 0; color: var(--text-muted); font-size: 10.5px; font-weight: 500;}
                
                .meta-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 40px; margin-bottom: 32px; }
                .meta-block { background-color: var(--bg-soft); padding: 20px 24px; border-radius: 8px; border: 1px solid var(--border-color);}
                .meta-block h4 { font-family: 'Bricolage Grotesque', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: var(--text-muted); margin: 0 0 12px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 6px; }
                .client-name { font-size: 20px; margin: 0 0 6px 0; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 600; color: #000; letter-spacing: -0.01em;}
                .meta-block p { margin: 2px 0; color: var(--text-muted); font-size: 11px; font-weight: 500;}
                .est-details p { display: flex; justify-content: space-between; border-bottom: 1px dashed var(--border-color); padding: 6px 0; margin: 0; font-size: 11px;}
                .est-details p strong { color: #000; font-weight: 600; font-family: 'Inter', sans-serif; }
                
                table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
                th { background: #000; color: #fff; font-family: 'Bricolage Grotesque', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; text-align: left; padding: 12px 8px; }
                th.text-center { text-align: center; }
                th.text-right { text-align: right; }
                td { padding: 16px 8px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
                
                .col-index { width: 4%; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 600; color: var(--text-muted); font-size: 12px; text-align:center;}
                .col-img { width: 18%; text-align:left;}
                .col-details { width: 30%; }
                .col-variant-size { width: 20%; font-weight: 500; font-size: 11px; color:#000;}
                .col-qty { width: 10%; text-align: center; font-weight: 500; font-size: 11px; color: var(--text-muted);}
                .col-moq { width: 8%; text-align: center; font-weight: 600; font-size: 11px; color:#000;}
                .col-price { width: 10%; text-align: right; font-weight: 700; font-size: 13px; color: #000; font-family: 'Inter', sans-serif;}

                .img-wrapper { display: flex; gap: 6px; flex-wrap:wrap; justify-content:flex-start;}
                .product-img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color); box-shadow: 0 2px 4px rgba(0,0,0,0.02);}
                
                .product-name { font-family: 'Bricolage Grotesque', sans-serif; font-size: 14px; font-weight: 600; color: #000; margin-bottom: 6px; text-transform: capitalize; letter-spacing: -0.01em;}
                .product-meta { margin-bottom: 8px; display: flex; gap: 6px;}
                .meta-pill { background: #fff; border: 1px solid var(--border-color); padding: 3px 6px; border-radius: 4px; font-size: 9px; color: var(--text-muted); font-weight: 600; font-family: 'Inter', sans-serif;}

                .footer { text-align: center; font-size: 10px; color: var(--text-muted); padding-top: 16px; margin-top: auto; font-family: 'Inter', sans-serif;}
            </style>
        </head>
        <body>
            <div class="document-wrapper">
                <div class="header">
                    <div class="logo-text">
                        <span class="c-b">B</span><span class="c-h">H</span><span class="c-a">A</span><span class="c-k">K</span><span class="c-t">T</span><span class="c-i">I</span>
                    </div>
                    <div class="sender-info">
                        <h3>Ankit Detroja</h3>
                        <p>WhatsApp: +91 82387 72094 / +91 9714154356</p>
                        <p>Email: ankit@bhaktidecor.com</p>
                        <p>Surat, Gujarat, India</p>
                    </div>
                </div>

                <div class="meta-grid">
                    <div class="meta-block">
                        <h4>Quotation To</h4>
                        <h2 class="client-name">${company}</h2>
                        ${contact ? `<p>${contact}</p>` : ""}
                        ${phone ? `<p>${phone}</p>` : ""}
                        ${address ? `<p style="margin-top: 6px; max-width: 90%; line-height:1.4;">${address}</p>` : ""}
                    </div>
                    <div class="meta-block est-details">
                        <h4>Estimate Data</h4>
                        <p><span>Reference Code</span> <strong>EST-${est.id.substring(0,6).toUpperCase()}</strong></p>
                        <p><span>Date Issued</span> <strong>${new Date(est.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong></p>
                        <p style="border-bottom: none; margin-top: 4px;"><span>Total Variations Included</span> <strong>${est.products.length}</strong></p>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th class="text-center">#</th>
                            <th>MEDIA ASSETS</th>
                            <th>PRODUCT IDENTIFICATION</th>
                            <th>VARIANT SIZE</th>
                            <th class="text-center">PACKAGE QTY</th>
                            <th class="text-center">MIN ORDER</th>
                            <th class="text-right">${priceLabel}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>

                <div class="footer">
                    Thank you for your business. For inquiries regarding this estimation, please reach out to our team.<br>
                    <strong>Confidential & Proprietary.</strong>
                </div>
            </div>

            <script>
                const link = document.createElement('link');
                link.href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=Inter:wght@400;500;600;700&display=swap";
                link.rel = "stylesheet";
                document.head.appendChild(link);
                // Synchronous delay guaranteed to render Google fonts and images
                window.onload = () => { setTimeout(() => { window.print(); }, 1500); };
            </script>
        </body>
        </html>
    `;

  const printWin = window.open("", "", "width=1200,height=800");
  printWin.document.open();
  printWin.document.write(printContent);
  printWin.document.close();
};

window.confirmDelete = (id, type) => {
  pendingDelete = { id, type };
  document.getElementById("confirmModal").classList.add("active");
};

document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
    const btn = document.getElementById("confirmDeleteBtn");
    btn.innerHTML = '<i class="ti ti-loader ti-spin"></i>';
    try {
      await deleteDoc(doc(db, pendingDelete.type, pendingDelete.id));
      if (pendingDelete.type === "products") loadProducts();
      if (pendingDelete.type === "categories") loadCategories();
      if (pendingDelete.type === "customers") loadCustomers();
      if (pendingDelete.type === "estimations") loadEstimations();
      document.getElementById("confirmModal").classList.remove("active");
    } catch (e) {
      alert("Delete failed.");
    } finally {
      btn.innerHTML = "Delete";
    }
});

// import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
// import { getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
// import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// const firebaseConfig = {
//   apiKey: "AIzaSyAJ1SeBgN_jMq1x1QOBBeiqDuIZJp9b050",
//   authDomain: "bhakti-decor.firebaseapp.com",
//   projectId: "bhakti-decor",
//   messagingSenderId: "288159506881",
//   appId: "1:288159506881:web:88d66406c064af9ceecf40",
// };

// const CLOUDINARY_CLOUD_NAME = "dqnrbibhi";
// const CLOUDINARY_UPLOAD_PRESET = "bhakti_products";

// const app = initializeApp(firebaseConfig);
// const db = getFirestore(app);
// const auth = getAuth(app);

// let productsCache = [];
// let categoriesCache = [];
// let customersCache = [];
// let estimationsCache = [];
// let selectedFiles = [];
// let existingImages = [];
// let pendingDelete = { id: null, type: null };
// window.flatEstItems = []; // Expose to window for estimation editing

// // ==========================================
// // HELPERS
// // ==========================================
// function getRandomColor(str) {
//   let hash = 0;
//   for (let i = 0; i < str.length; i++) { hash = str.charCodeAt(i) + ((hash << 5) - hash); }
//   const c = (hash & 0x00ffffff).toString(16).toUpperCase();
//   return "#" + "00000".substring(0, 6 - c.length) + c;
// }

// function getInitials(name) {
//   if (!name) return "?";
//   return name.charAt(0).toUpperCase();
// }

// // ==========================================
// // AUTHENTICATION
// // ==========================================
// const loginOverlay = document.getElementById("loginOverlay");
// const loginForm = document.getElementById("loginForm");
// const loginBtn = document.getElementById("loginBtn");

// onAuthStateChanged(auth, (user) => {
//   if (user) {
//     loginOverlay.style.opacity = "0";
//     setTimeout(() => (loginOverlay.style.display = "none"), 1000);
//     loadCategories();
//     loadCustomers();
//     loadProducts();
//     loadEstimations();
//   } else {
//     loginOverlay.style.display = "flex";
//     loginBtn.classList.remove("is-loading");
//     loginBtn.innerHTML = 'Log In <i class="ti ti-arrow-right"></i>';
//     setTimeout(() => (loginOverlay.style.opacity = "1"), 10);
//   }
// });

// loginForm.addEventListener("submit", async (e) => {
//   e.preventDefault();
//   const email = document.getElementById("loginEmail").value;
//   const password = document.getElementById("loginPassword").value;
//   try { await signInWithEmailAndPassword(auth, email, password); } 
//   catch (error) {
//     document.getElementById("loginError").style.display = "block";
//     loginBtn.classList.remove("is-loading");
//     loginBtn.innerHTML = 'Log In <i class="ti ti-arrow-right"></i>';
//   }
// });

// document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

// // ==========================================
// // DASHBOARD & LIST COUNTS
// // ==========================================
// function updateDashboard() {
//   document.getElementById("dashTotalProducts").innerText = productsCache.length;
//   document.getElementById("dashActiveProducts").innerText = productsCache.filter((p) => p.isActive).length;
//   document.getElementById("dashTotalCustomers").innerText = customersCache.length;
//   document.getElementById("dashTotalEstimations").innerText = estimationsCache.length;

//   document.getElementById("productsTitle").innerText = `Products (${productsCache.length})`;
//   document.getElementById("categoriesTitle").innerText = `Categories (${categoriesCache.length})`;
//   document.getElementById("customersTitle").innerText = `Customers (${customersCache.length})`;
//   document.getElementById("estimationsTitle").innerText = `Estimations (${estimationsCache.length})`;

//   const catCounts = {};
//   productsCache.forEach((p) => {
//     const cats = p.categories || (p.category ? [p.category] : []);
//     cats.forEach(cat => { catCounts[cat] = (catCounts[cat] || 0) + 1; });
//   });

//   let statsHtml = "";
//   Object.entries(catCounts).forEach(([cat, count]) => {
//     const percent = productsCache.length === 0 ? 0 : (count / productsCache.length) * 100;
//     statsHtml += `<div class="stat-bar-wrapper"><div class="stat-bar-label"><span>${cat}</span><span>${count} Items</span></div><div class="stat-bar-bg"><div class="stat-bar-fill" style="width: ${percent}%"></div></div></div>`;
//   });
//   document.getElementById("categoryStatsList").innerHTML = statsHtml || '<p style="color:var(--text-secondary); font-size:13px;">No product data available yet.</p>';

//   const recentList = document.getElementById("recentEstimationsList");
//   let recentHtml = "";
//   const recentEsts = [...estimationsCache].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);

//   if (recentEsts.length === 0) {
//     recentHtml = '<p style="color:var(--text-secondary); font-size:13px;">No estimations sent yet.</p>';
//   } else {
//     recentEsts.forEach((e) => {
//       recentHtml += `
//           <li class="recent-item">
//               <div class="recent-info">
//                   <h4>${e.customerName}</h4>
//                   <p>${new Date(e.date).toLocaleDateString()}</p>
//               </div>
//               <span class="recent-badge">${e.products.length} Items</span>
//           </li>`;
//     });
//   }
//   recentList.innerHTML = recentHtml;
// }

// function validateForm(formId) {
//   const form = document.getElementById(formId);
//   let isValid = true;
//   form.querySelectorAll("[required]").forEach((input) => {
//     const group = input.closest(".form-group, .floating-input, .variant-row");
//     if (!input.value.trim()) { group.classList.add("invalid"); isValid = false; } 
//     else { group.classList.remove("invalid"); }
//   });

//   if (formId === "productForm") {
//     const imgGroup = document.getElementById("dropZone").closest(".form-group");
//     if (selectedFiles.length === 0 && existingImages.length === 0) { imgGroup.classList.add("invalid"); isValid = false; } 
//     else { imgGroup.classList.remove("invalid"); }
    
//     const catGroup = document.getElementById('productCategoryContainer').closest('.form-group');
//     const checkedCats = document.querySelectorAll('input[name="productCategories"]:checked');
//     if (checkedCats.length === 0) { catGroup.classList.add('invalid'); isValid = false; } 
//     else { catGroup.classList.remove('invalid'); }

//     // Validate Variants
//     const varsContainer = document.getElementById('variantsContainer');
//     const varRows = varsContainer.querySelectorAll('.variant-row');
//     if(varRows.length === 0) {
//         varsContainer.parentElement.classList.add('invalid'); isValid = false;
//     } else {
//         varsContainer.parentElement.classList.remove('invalid');
//     }
//   }

//   form.querySelectorAll("input, textarea, select").forEach((input) => {
//     input.addEventListener("input", () => {
//         const p = input.closest(".form-group, .floating-input, .variant-row");
//         if(p) p.classList.remove("invalid");
//     }, { once: true });
//   });
//   return isValid;
// }

// // ==========================================
// // DYNAMIC VARIANT BUILDER
// // ==========================================
// window.addVariantRow = (size='', cost='', india='', exp='') => {
//     const container = document.getElementById('variantsContainer');
//     const div = document.createElement('div');
//     div.className = 'variant-row';
//     div.innerHTML = `
//         <div><label>Size Name (e.g. 4inch)</label><input type="text" class="v-size" value="${size}" required></div>
//         <div><label>Cost (₹)</label><input type="number" class="v-cost" value="${cost}" required></div>
//         <div><label>India (₹)</label><input type="number" class="v-india" value="${india}" required></div>
//         <div><label>Export ($)</label><input type="number" class="v-export" value="${exp}" required></div>
//         <button type="button" class="del-btn" onclick="this.parentElement.remove()"><i class="ti ti-trash"></i></button>
//     `;
//     container.appendChild(div);
// };

// // ==========================================
// // CUSTOMER MODULE
// // ==========================================
// async function loadCustomers() {
//   const list = document.getElementById("customerList");
//   const estDropdown = document.getElementById("estCustomerSelect");
//   const filterDropdown = document.getElementById("filterEstCustomer");

//   try {
//     const snapshot = await getDocs(collection(db, "customers"));
//     customersCache = [];

//     if (snapshot.empty) {
//       list.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="ti ti-users"></i><p>No customers found.</p></div></td></tr>`;
//       estDropdown.innerHTML = '<option value="" disabled selected>No customers...</option>';
//       filterDropdown.innerHTML = '<option value="ALL">All Customers</option>';
//       updateDashboard(); return;
//     }

//     estDropdown.innerHTML = '<option value="" disabled selected>Select customer...</option>';
//     filterDropdown.innerHTML = '<option value="ALL">All Customers</option>';

//     snapshot.forEach((docSnap) => {
//       const data = docSnap.data(); data.id = docSnap.id; customersCache.push(data);
//       estDropdown.innerHTML += `<option value="${data.id}">${data.companyName}</option>`;
//       filterDropdown.innerHTML += `<option value="${data.id}">${data.companyName}</option>`;
//     });

//     renderCustomerTable();
//     updateDashboard();
//   } catch (e) {}
// }

// function renderCustomerTable() {
//   const list = document.getElementById("customerList");
//   list.innerHTML = "";
//   customersCache.forEach((data) => {
//     const bgColor = getRandomColor(data.companyName);
//     const initial = getInitials(data.companyName);
//     list.innerHTML += `<tr><td><div class="customer-cell"><div class="avatar-circle" style="background-color: ${bgColor};">${initial}</div><span style="font-weight: 500; color: white;">${data.companyName}</span></div></td><td style="color:var(--text-secondary);">${data.contactPerson || "-"}</td><td style="color:var(--text-secondary);">${data.phone || "-"}</td><td><div class="actions-cell"><button class="action-icon" onclick="window.viewCustomer('${data.id}')"><i class="ti ti-eye"></i></button><button class="action-icon" onclick="window.editCustomer('${data.id}')"><i class="ti ti-pencil"></i></button><button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'customers')"><i class="ti ti-trash"></i></button></div></td></tr>`;
//   });
// }

// document.getElementById("customerForm").addEventListener("submit", async (e) => {
//     e.preventDefault(); if (!validateForm("customerForm")) return;
//     const btn = document.getElementById("custSubmitBtn"); const id = document.getElementById("customerId").value;
//     const originalHtml = btn.innerHTML; btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Saving...'; btn.disabled = true;

//     const data = {
//       companyName: document.getElementById("custCompany").value,
//       contactPerson: document.getElementById("custContact").value,
//       emails: document.getElementById("custEmails").value,
//       phone: document.getElementById("custPhone").value,
//       country: document.getElementById("custCountry").value,
//       website: document.getElementById("custWebsite").value,
//       address: document.getElementById("custAddress").value,
//       notes: document.getElementById("custNotes").value,
//     };

//     try {
//       if (id) await updateDoc(doc(db, "customers", id), data);
//       else { data.createdAt = new Date().toISOString(); await addDoc(collection(db, "customers"), data); }
//       document.getElementById("customerForm").reset(); loadCustomers(); document.querySelectorAll(".nav-btn")[4].click();
//     } catch (err) { alert("Error saving customer."); } finally { btn.innerHTML = originalHtml; btn.disabled = false; }
// });

// window.viewCustomer = (id) => {
//   const c = customersCache.find((x) => x.id === id); if (!c) return;
//   const bgColor = getRandomColor(c.companyName); const initial = getInitials(c.companyName);
//   document.getElementById("viewCustomerBody").innerHTML = `
//         <div style="display:flex; align-items:center; gap:20px; margin-bottom: 30px; border-bottom: 1px solid var(--glass-border); padding-bottom: 30px;">
//             <div class="avatar-circle" style="background-color: ${bgColor}; width: 64px; height: 64px; font-size: 28px;">${initial}</div>
//             <div><h2 style="font-family:'Bricolage Grotesque', sans-serif; font-size:28px; font-weight:400; color:var(--text-primary); margin-bottom:4px;">${c.companyName}</h2><span style="color:var(--text-secondary); font-size:13px; text-transform:uppercase; letter-spacing:1px;">Client Profile</span></div>
//         </div>
//         <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px;">
//             <div class="detail-block"><h4>Contact Person</h4><p style="color:white;">${c.contactPerson || "-"}</p></div>
//             <div class="detail-block"><h4>Emails</h4><p style="color:white;">${c.emails || "-"}</p></div>
//             <div class="detail-block"><h4>Phone</h4><p style="color:white;">${c.phone || "-"}</p></div>
//             <div class="detail-block"><h4>Country</h4><p style="color:white;">${c.country || "-"}</p></div>
//             <div class="detail-block" style="grid-column: 1 / -1;"><h4>Website</h4><p style="color:white;">${c.website || "-"}</p></div>
//             <div class="detail-block" style="grid-column: 1 / -1;"><h4>Full Address</h4><p style="color:white;">${c.address || "-"}</p></div>
//             <div class="detail-block" style="grid-column: 1 / -1;"><h4>Internal Notes</h4><p style="color:white;">${c.notes || "-"}</p></div>
//         </div>`;
//   document.getElementById("viewCustomerModal").classList.add("active");
// };

// window.editCustomer = (id) => {
//   const c = customersCache.find((x) => x.id === id); if (!c) return;
//   document.getElementById("custFormTitle").innerText = "Edit Customer"; document.getElementById("custSubmitBtn").innerHTML = 'Update Customer <i class="ti ti-check"></i>';
//   document.getElementById("customerId").value = c.id; document.getElementById("custCompany").value = c.companyName || ""; document.getElementById("custContact").value = c.contactPerson || ""; document.getElementById("custEmails").value = c.emails || ""; document.getElementById("custPhone").value = c.phone || ""; document.getElementById("custCountry").value = c.country || ""; document.getElementById("custWebsite").value = c.website || ""; document.getElementById("custAddress").value = c.address || ""; document.getElementById("custNotes").value = c.notes || "";
//   document.querySelectorAll(".section").forEach((sec) => sec.classList.remove("active")); document.getElementById("addCustomer").classList.add("active");
// };

// // ==========================================
// // CATEGORY MANAGEMENT
// // ==========================================
// async function loadCategories() {
//   const list = document.getElementById("categoryList");
//   const filterDropdown = document.getElementById("filterProductCat");
//   const multiCatContainer = document.getElementById("productCategoryContainer");

//   try {
//     const snapshot = await getDocs(collection(db, "categories"));
//     list.innerHTML = ""; filterDropdown.innerHTML = '<option value="ALL">All Categories</option>'; multiCatContainer.innerHTML = '';
//     categoriesCache = [];

//     if (snapshot.empty) { list.innerHTML = `<tr><td colspan="3"><div class="empty-state"><p>No categories found.</p></div></td></tr>`; updateDashboard(); return; }

//     snapshot.forEach((docSnap) => {
//       const data = docSnap.data(); data.id = docSnap.id; categoriesCache.push(data);
//       if (data.isActive) {
//         filterDropdown.innerHTML += `<option value="${data.name}">${data.name}</option>`;
//         multiCatContainer.innerHTML += `<label class="cat-pill-label"><input type="checkbox" name="productCategories" value="${data.name}"><div class="cat-pill">${data.name}</div></label>`;
//       }
//       const statusBadge = data.isActive ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>';
//       list.innerHTML += `<tr><td style="color: white;">${data.name}</td><td><div class="status-cell"><label class="switch"><input type="checkbox" onchange="window.toggleCategory('${data.id}', ${data.isActive})" ${data.isActive ? "checked" : ""}><span class="slider"></span></label>${statusBadge}</div></td><td><div class="actions-cell"><button class="action-icon" onclick="window.editCategory('${data.id}')"><i class="ti ti-pencil"></i></button><button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'categories')"><i class="ti ti-trash"></i></button></div></td></tr>`;
//     });
//     updateDashboard();
//   } catch (error) {}
// }

// document.getElementById("categoryForm").addEventListener("submit", async (e) => {
//     e.preventDefault(); if (!validateForm("categoryForm")) return;
//     const btn = document.getElementById("catSubmitBtn"); const id = document.getElementById("categoryId").value; const name = document.getElementById("categoryName").value.trim();
//     btn.innerHTML = '<i class="ti ti-loader ti-spin"></i>'; btn.disabled = true;
//     try {
//       if (id) await updateDoc(doc(db, "categories", id), { name });
//       else await addDoc(collection(db, "categories"), { name, isActive: true, createdAt: new Date().toISOString() });
//       document.getElementById("catModal").classList.remove("active"); loadCategories();
//     } catch (error) { alert("Error saving."); } finally { btn.innerHTML = "Save Category"; btn.disabled = false; }
//   });
// window.editCategory = (id) => { const cat = categoriesCache.find((c) => c.id === id); if (!cat) return; document.getElementById("categoryId").value = cat.id; document.getElementById("categoryName").value = cat.name; document.getElementById("catModalTitle").innerText = "Edit Category"; document.getElementById("catModal").classList.add("active"); };
// window.toggleCategory = async (id, status) => { await updateDoc(doc(db, "categories", id), { isActive: !status }); loadCategories(); };

// // ==========================================
// // PRODUCT MANAGEMENT & MULTI-CATEGORY FILTERING
// // ==========================================
// window.filterProductList = () => { renderProductsTable(document.getElementById("filterProductCat").value); };

// function renderProductsTable(filterCat = "ALL") {
//   const list = document.getElementById("productList");
//   list.innerHTML = "";
//   let filtered = productsCache;
//   if (filterCat !== "ALL") filtered = productsCache.filter((p) => p.categories && p.categories.includes(filterCat));
//   if (filtered.length === 0) { list.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="ti ti-shopping-bag-x"></i><p>No products match this filter.</p></div></td></tr>`; return; }

//   filtered.forEach((data) => {
//     const imgUrl = data.images && data.images.length > 0 ? data.images[0] : "";
//     const statusBadge = data.isActive ? '<span class="badge badge-active">Publish</span>' : '<span class="badge badge-inactive">Inactive</span>';
//     const cats = data.categories || (data.category ? [data.category] : []);
//     const catBadges = cats.map(c => `<span class="badge" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #d4d4d8; margin-right: 4px; display:inline-block; margin-bottom: 4px;">${c}</span>`).join('');
    
//     // Fallback logic for price display (supports new array format and old string format)
//     const variants = data.pricing || [{size: data.sizeDetails||'Standard', cost: data.mfgCost, india: data.priceIndia, export: data.priceExport}];
//     const prices = variants.map(v => Number(v.india) || 0);
//     const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
//     const priceDisplay = variants.length > 1 ? `From ₹${minPrice}` : `₹${minPrice}`;

//     list.innerHTML += `<tr><td><div class="product-cell">${imgUrl ? `<img src="${imgUrl}" class="img-thumb">` : `<div class="img-thumb" style="display:flex; justify-content:center; align-items:center;"><i class="ti ti-photo-off"></i></div>`}<div class="product-info"><span class="product-title">${data.name}</span><p class="product-desc-text">${data.description || "No description"}</p></div></div></td><td style="max-width:200px;">${catBadges}</td><td style="font-weight: 500; font-size: 14px; color: white;">${priceDisplay}</td><td><div class="status-cell"><label class="switch"><input type="checkbox" onchange="window.toggleProduct('${data.id}', ${data.isActive})" ${data.isActive ? "checked" : ""}><span class="slider"></span></label>${statusBadge}</div></td><td><div class="actions-cell"><button class="action-icon" onclick="window.viewProduct('${data.id}')"><i class="ti ti-eye"></i></button><button class="action-icon" onclick="window.editProduct('${data.id}')"><i class="ti ti-pencil"></i></button><button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'products')"><i class="ti ti-trash"></i></button></div></td></tr>`;
//   });
// }

// async function loadProducts() {
//   try {
//     const querySnapshot = await getDocs(collection(db, "products"));
//     productsCache = [];
//     querySnapshot.forEach((docSnap) => {
//       const data = docSnap.data(); data.id = docSnap.id;
//       if(!data.categories && data.category) data.categories = [data.category]; // Retrofit
//       productsCache.push(data);
//     });
//     renderProductsTable();
//     updateDashboard();
//   } catch (error) {}
// }

// const dropZone = document.getElementById("dropZone");
// const fileInput = document.getElementById("productImages");
// const previewContainer = document.getElementById("imagePreviews");
// dropZone.addEventListener("click", () => fileInput.click()); fileInput.addEventListener("change", (e) => handleFiles(e.target.files)); dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); }); dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover") ); dropZone.addEventListener("drop", (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); handleFiles(e.dataTransfer.files); });
// window.addEventListener("clearImages", () => { selectedFiles = []; existingImages = []; renderPreviews(); });

// function handleFiles(files) { selectedFiles = [...selectedFiles, ...Array.from(files)]; fileInput.value = ""; document.getElementById("dropZone").closest(".form-group").classList.remove("invalid"); renderPreviews(); }
// function renderPreviews() { previewContainer.innerHTML = ""; existingImages.forEach((url, index) => { previewContainer.innerHTML += `<div class="preview-item"><img src="${url}"><button type="button" class="remove-btn" onclick="window.removeExistingImage(${index})"><i class="ti ti-x"></i></button></div>`; }); selectedFiles.forEach((file, index) => { const reader = new FileReader(); reader.onload = (e) => { previewContainer.innerHTML += `<div class="preview-item"><img src="${e.target.result}"><button type="button" class="remove-btn" onclick="window.removeLocalFile(${index})"><i class="ti ti-x"></i></button></div>`; }; reader.readAsDataURL(file); }); }
// window.removeLocalFile = (index) => { selectedFiles.splice(index, 1); renderPreviews(); }; window.removeExistingImage = (index) => { existingImages.splice(index, 1); renderPreviews(); };
// async function uploadToCloudinary(file) { const fd = new FormData(); fd.append("file", file); fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET); const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: fd }); if (!res.ok) throw new Error("Upload failed"); return (await res.json()).secure_url; }

// productForm.addEventListener("submit", async (e) => {
//   e.preventDefault();
//   if (!validateForm("productForm")) return;
//   const btn = document.getElementById("submitBtn"); const editId = document.getElementById("productId").value;
//   const originalHtml = btn.innerHTML; btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Saving...'; btn.disabled = true;

//   try {
//     let finalImageUrls = [...existingImages];
//     for (let i = 0; i < selectedFiles.length; i++) finalImageUrls.push(await uploadToCloudinary(selectedFiles[i]));
//     const kw = document.getElementById("seoKeywords").value.split(",").map((k) => k.trim()).filter((k) => k !== "");
//     const selectedCats = Array.from(document.querySelectorAll('input[name="productCategories"]:checked')).map(cb => cb.value);

//     // Extract dynamic variations
//     const pricingArray = [];
//     document.querySelectorAll('.variant-row').forEach(row => {
//         pricingArray.push({
//             size: row.querySelector('.v-size').value,
//             cost: Number(row.querySelector('.v-cost').value),
//             india: Number(row.querySelector('.v-india').value),
//             export: Number(row.querySelector('.v-export').value)
//         });
//     });

//     const data = {
//       name: document.getElementById("productName").value,
//       categories: selectedCats,
//       description: document.getElementById("productDesc").value,
//       pricing: pricingArray, // NEW STRUCTURE
//       hsCode: document.getElementById("hsCode").value,
//       gsm: document.getElementById("gsm").value,
//       moq: Number(document.getElementById("moq").value),
//       qtyInPackage: document.getElementById("qtyInPackage").value,
//       seoKeywords: kw,
//       images: finalImageUrls,
//     };

//     if (editId) await updateDoc(doc(db, "products", editId), data);
//     else { data.isActive = true; data.createdAt = new Date().toISOString(); await addDoc(collection(db, "products"), data); }
//     productForm.reset(); document.getElementById("productId").value = ""; window.dispatchEvent(new Event("clearImages"));
//     loadProducts(); document.querySelectorAll(".nav-btn")[2].click();
//   } catch (error) { alert("Failed to save product."); } 
//   finally { btn.innerHTML = originalHtml; btn.disabled = false; }
// });

// window.toggleProduct = async (id, status) => { await updateDoc(doc(db, "products", id), { isActive: !status }); loadProducts(); };

// window.viewProduct = (id) => {
//   const p = productsCache.find((x) => x.id === id); if (!p) return;
//   let thumbsHtml = ""; const mainImg = p.images && p.images.length > 0 ? p.images[0] : "https://via.placeholder.com/400";
//   if (p.images) p.images.forEach((img) => (thumbsHtml += `<img src="${img}" onclick="document.getElementById('mainViewImg').src='${img}'">`));
//   const cats = p.categories || (p.category ? [p.category] : []);
//   const catHtml = cats.map(c => `<span class="modal-cat" style="display:inline-block; margin-right: 8px;">${c}</span>`).join('');

//   const variants = p.pricing || [{size: p.sizeDetails||'Standard', cost: p.mfgCost, india: p.priceIndia, export: p.priceExport}];
//   let pricingHtml = `<table style="width:100%; text-align:left; margin-bottom:20px;"><thead><tr><th style="color:var(--text-secondary);">Size</th><th style="color:var(--text-secondary);">Cost</th><th style="color:var(--text-secondary);">India</th><th style="color:var(--text-secondary);">Export</th></tr></thead><tbody>`;
//   variants.forEach(v => { pricingHtml += `<tr><td style="color:white;">${v.size}</td><td style="color:white;">₹${v.cost}</td><td style="color:white;">₹${v.india}</td><td style="color:white;">$${v.export}</td></tr>`; });
//   pricingHtml += `</tbody></table>`;

//   document.getElementById("viewModalBody").innerHTML = `
//     <div style="display: grid; grid-template-columns: 1fr 1fr;">
//         <div class="modal-gallery"><img src="${mainImg}" class="main-img-view" id="mainViewImg"><div class="thumb-grid">${thumbsHtml}</div></div>
//         <div class="modal-details" style="padding-top: 20px;">
//             <div style="margin-bottom:8px;">${catHtml}</div>
//             <h2 class="modal-title" style="font-size:24px; margin-bottom: 20px;">${p.name}</h2>
//             ${pricingHtml}
//             <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom: 20px; border-top:1px solid var(--glass-border); padding-top:20px;">
//                 <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase;">HS Code</h4><p style="color:white; font-size:13px;">${p.hsCode || "-"}</p></div>
//                 <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase;">Default MOQ</h4><p style="color:white; font-size:13px;">${p.moq || "-"}</p></div>
//                 <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase;">GSM</h4><p style="color:white; font-size:13px;">${p.gsm || "-"}</p></div>
//                 <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase;">Package Qty</h4><p style="color:white; font-size:13px;">${p.qtyInPackage || "-"}</p></div>
//             </div>
//             <div class="detail-block"><h4>Description</h4><p>${p.description}</p></div>
//         </div>
//     </div>`;
//   document.getElementById("viewModal").classList.add("active");
// };

// window.editProduct = (id) => {
//   const p = productsCache.find((x) => x.id === id); if (!p) return;
//   document.getElementById("formTitle").innerText = "Edit Product";
//   document.getElementById("submitBtn").innerHTML = 'Update Product <i class="ti ti-check"></i>';
//   document.getElementById("productId").value = p.id;
//   document.getElementById("productName").value = p.name;
//   document.getElementById("hsCode").value = p.hsCode || "";
//   document.getElementById("gsm").value = p.gsm || "";
//   document.getElementById("moq").value = p.moq || "";
//   document.getElementById("qtyInPackage").value = p.qtyInPackage || "";
//   document.getElementById("seoKeywords").value = p.seoKeywords ? p.seoKeywords.join(", ") : "";
//   document.getElementById("productDesc").value = p.description;

//   document.querySelectorAll('input[name="productCategories"]').forEach(cb => cb.checked = false);
//   const catsToSelect = p.categories || (p.category ? [p.category] : []);
//   catsToSelect.forEach(c => { const cb = document.querySelector(`input[name="productCategories"][value="${c}"]`); if(cb) cb.checked = true; });

//   const varsContainer = document.getElementById('variantsContainer');
//   varsContainer.innerHTML = '';
//   const variants = p.pricing || [{size: p.sizeDetails||'', cost: p.mfgCost, india: p.priceIndia, export: p.priceExport}];
//   variants.forEach(v => window.addVariantRow(v.size, v.cost, v.india, v.export));

//   existingImages = p.images || []; selectedFiles = []; renderPreviews();
//   document.querySelectorAll(".form-group, .floating-input").forEach((el) => el.classList.remove("invalid"));
//   document.querySelectorAll(".section").forEach((sec) => sec.classList.remove("active"));
//   document.getElementById("addProduct").classList.add("active");
// };

// // ==========================================
// // ESTIMATION WIZARD & FILTERING
// // ==========================================
// window.filterEstimationList = () => { renderEstimationsTable(document.getElementById("filterEstCustomer").value); };

// function renderEstimationsTable(custId = "ALL") {
//   const list = document.getElementById("estimationList");
//   list.innerHTML = "";
//   let filtered = estimationsCache;
//   if (custId !== "ALL") filtered = estimationsCache.filter((e) => e.customerId === custId);
//   if (filtered.length === 0) { list.innerHTML = `<tr><td colspan="4"><div class="empty-state"><p>No estimations found.</p></div></td></tr>`; return; }

//   filtered.forEach((data) => {
//     const d = new Date(data.date).toLocaleDateString();
//     list.innerHTML += `<tr><td style="color:var(--text-secondary);">${d}</td><td style="color:white; font-weight:500;">${data.customerName}</td><td style="color:white;">${data.products.length} Items</td><td><div class="actions-cell"><button class="action-icon" onclick="printEstimation('${data.id}')" title="Print/Download PDF"><i class="ti ti-printer"></i></button><button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'estimations')"><i class="ti ti-trash"></i></button></div></td></tr>`;
//   });
// }

// async function loadEstimations() {
//   try {
//     const snapshot = await getDocs(collection(db, "estimations"));
//     estimationsCache = []; snapshot.forEach((docSnap) => { const data = docSnap.data(); data.id = docSnap.id; estimationsCache.push(data); });
//     renderEstimationsTable(); updateDashboard();
//   } catch (e) {}
// }

// let currentEstProducts = [];

// window.openCreateEstimation = () => {
//   document.getElementById("estCustomerSelect").value = "";
//   document.getElementById("estSearchProduct").value = "";
//   document.getElementById("estCustError").style.display = "none";
//   currentEstProducts = [];
//   renderEstProductSelection();

//   document.getElementById("step1-ind").classList.add("active"); document.getElementById("step2-ind").classList.remove("active");
//   document.getElementById("estStep1").classList.add("active"); document.getElementById("estStep2").classList.remove("active");
//   document.querySelectorAll(".section").forEach((sec) => sec.classList.remove("active"));
//   document.getElementById("createEstimation").classList.add("active");
// };

// function renderEstProductSelection(filterText = "") {
//   const list = document.getElementById("estProductSelectionList");
//   list.innerHTML = "";
//   const filtered = productsCache.filter((p) => p.isActive && p.name.toLowerCase().includes(filterText.toLowerCase()));

//   filtered.forEach((p) => {
//     const img = p.images && p.images.length > 0 ? p.images[0] : "https://via.placeholder.com/50";
//     const isSelected = currentEstProducts.find((cp) => cp.id === p.id) ? "checked" : "";
//     const cardClass = isSelected ? "selectable-card selected" : "selectable-card";
    
//     // Display starting price
//     const variants = p.pricing || [{export: p.priceExport}];
//     const minPrice = variants.length > 0 ? Math.min(...variants.map(v => Number(v.export)||0)) : 0;
    
//     list.innerHTML += `<label class="${cardClass}"><input type="checkbox" value="${p.id}" ${isSelected} onchange="toggleEstProduct(this, '${p.id}')"><img src="${img}"><div style="display:flex; flex-direction:column;"><span style="font-weight:500; font-size:13px; color:white;">${p.name}</span><span style="font-size:11px; color:var(--text-secondary);">From $${minPrice} | MOQ: ${p.moq || "-"}</span></div></label>`;
//   });
// }

// window.filterEstProducts = () => { renderEstProductSelection(document.getElementById("estSearchProduct").value); };

// window.toggleEstProduct = (checkbox, id) => {
//   const card = checkbox.closest(".selectable-card");
//   if (checkbox.checked) {
//     card.classList.add("selected");
//     const p = productsCache.find((x) => x.id === id);
//     currentEstProducts.push({ ...p });
//   } else {
//     card.classList.remove("selected");
//     currentEstProducts = currentEstProducts.filter((x) => x.id !== id);
//   }
// };

// // Flatten selected products into variations for Step 2
// window.goToEstStep2 = () => {
//   if (!document.getElementById("estCustomerSelect").value) { document.getElementById("estCustError").style.display = "block"; return; }
//   if (currentEstProducts.length === 0) { alert("Please select at least one product."); return; }

//   document.getElementById("estCustError").style.display = "none";
//   document.getElementById("step1-ind").classList.remove("active"); document.getElementById("step2-ind").classList.add("active");
//   document.getElementById("estStep1").classList.remove("active"); document.getElementById("estStep2").classList.add("active");

//   const tbody = document.getElementById("estEditableTableBody");
//   tbody.innerHTML = "";
  
//   window.flatEstItems = [];
//   let rowIndex = 0;

//   currentEstProducts.forEach((p) => {
//     const variants = p.pricing || [{size: p.sizeDetails||'Standard', export: p.priceExport}];
//     variants.forEach(v => {
//         window.flatEstItems.push({
//             ...p,
//             variantSize: v.size,
//             defaultExport: v.export
//         });
        
//         tbody.innerHTML += `
//             <tr id="estRow_${rowIndex}">
//                 <td style="font-size:12px; font-weight:500; color:white;">${p.name} <br><span style="color:var(--text-secondary); font-size:10px; font-weight:400;">(${v.size})</span></td>
//                 <td><input type="number" id="estMoq_${rowIndex}" value="${p.moq || 0}" style="width:70px; color:white;"></td>
//                 <td><input type="text" id="estQty_${rowIndex}" value="${p.qtyInPackage || ""}" style="width:100px; color:white;"></td>
//                 <td><input type="number" step="0.01" id="estPrice_${rowIndex}" value="${v.export || 0}" style="width:80px; color:white;"></td>
//                 <td><button type="button" class="action-icon delete" onclick="removeEstRow(${rowIndex})" style="width:30px; height:30px;"><i class="ti ti-trash"></i></button></td>
//             </tr>
//         `;
//         rowIndex++;
//     });
//   });
// };

// window.removeEstRow = (index) => {
//     document.getElementById(`estRow_${index}`).style.display = 'none';
//     // Mark as deleted internally so we don't save it
//     window.flatEstItems[index].deleted = true;
// };

// window.backToEstStep1 = () => {
//   document.getElementById("step2-ind").classList.remove("active"); document.getElementById("step1-ind").classList.add("active");
//   document.getElementById("estStep2").classList.remove("active"); document.getElementById("estStep1").classList.add("active");
// };

// window.saveEstimation = async () => {
//   const btn = document.getElementById("saveEstBtn");
//   btn.innerHTML = '<i class="ti ti-loader ti-spin"></i>'; btn.disabled = true;

//   const finalItems = [];
//   window.flatEstItems.forEach((item, index) => {
//       if(!item.deleted) {
//           item.estMoq = document.getElementById(`estMoq_${index}`).value;
//           item.estQtyInPackage = document.getElementById(`estQty_${index}`).value;
//           item.estPriceExport = document.getElementById(`estPrice_${index}`).value;
//           finalItems.push(item);
//       }
//   });

//   if(finalItems.length === 0) {
//       alert("Cannot save an empty estimation.");
//       btn.innerHTML = 'Save & Generate <i class="ti ti-file-invoice"></i>'; btn.disabled = false;
//       return;
//   }

//   const custId = document.getElementById("estCustomerSelect").value;
//   const cust = customersCache.find((c) => c.id === custId);
//   const estData = { customerId: cust.id, customerName: cust.companyName, date: new Date().toISOString(), products: finalItems };

//   try {
//     const docRef = await addDoc(collection(db, "estimations"), estData);
//     loadEstimations(); document.querySelectorAll(".nav-btn")[1].click(); printEstimation(docRef.id);
//   } catch (err) { alert("Error saving estimation."); } 
//   finally { btn.innerHTML = 'Save & Generate <i class="ti ti-file-invoice"></i>'; btn.disabled = false; }
// };

// // ==========================================
// // 100% REDESIGNED PRINT ENGINE 
// // ==========================================
// window.printEstimation = (id) => {
//   const est = estimationsCache.find((e) => e.id === id);
//   if (!est) return;

//   const cust = customersCache.find((c) => c.id === est.customerId);
//   const company = cust ? cust.companyName : est.customerName;
//   const contact = cust && cust.contactPerson ? cust.contactPerson : "";
//   const phone = cust && cust.phone ? cust.phone : "";
//   const address = cust && cust.address ? cust.address : "";
//   const emails = cust && cust.emails ? cust.emails : "";

//   let rowsHtml = "";
//   est.products.forEach((p, index) => {
//     let imagesGrid = "";
//     if (p.images && p.images.length > 0) {
//       const imagesToShow = p.images.slice(0, 3);
//       imagesToShow.forEach((img) => { imagesGrid += `<img src="${img}" class="product-img">`; });
//     }
    
//     const printCats = p.categories || (p.category ? [p.category] : []);
    
//     rowsHtml += `
//             <tr>
//                 <td class="col-index">${String(index + 1).padStart(2, "0")}</td>
//                 <td class="col-img"><div class="img-wrapper">${imagesGrid}</div></td>
//                 <td class="col-details">
//                     <div class="product-name">${p.name} <span style="font-weight:400; font-size:10px; color:#52525b; margin-left:6px;">${printCats.join(', ')}</span></div>
//                     <div class="product-meta">
//                         <span class="meta-pill">HS CODE: ${p.hsCode || "-"}</span>
//                         <span class="meta-pill">GSM: ${p.gsm || "-"}</span>
//                     </div>
//                     <div class="product-size">${p.variantSize || "-"}</div>
//                 </td>
//                 <td class="col-qty">${p.estQtyInPackage || "-"}</td>
//                 <td class="col-moq">${p.estMoq || "-"}</td>
//                 <td class="col-price">$${p.estPriceExport || "-"}</td>
//             </tr>
//         `;
//   });

//   const printContent = `
//         <!DOCTYPE html>
//         <html lang="en">
//         <head>
//             <meta charset="UTF-8">
//             <title>Estimate - ${company}</title>
//             <style>
//                 :root { --text-main: #000000; --text-muted: #52525b; --border-color: #e4e4e7; --bg-soft: #f4f4f5; }
//                 * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
//                 body { font-family: 'Inter', sans-serif; color: var(--text-main); margin: 0; padding: 40px; font-size: 12px; line-height: 1.5; background: #fff; }
//                 @page { size: A4 landscape; margin: 12mm; }
//                 .document-wrapper { display: flex; flex-direction: column; min-height: 90vh; }
//                 .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 30px; border-bottom: 1px solid var(--border-color); margin-bottom: 40px; }
//                 .logo-text { font-family: 'Bricolage Grotesque', sans-serif; font-size: 40px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; line-height: 1; margin: 0; }
//                 .c-b { color: #2e3192; } .c-h { color: #8cc63f; } .c-a { color: #f15a24; } .c-k { color: #f7931e; } .c-t { color: #009245; } .c-i { color: #1c75bc; }
//                 .sender-info { text-align: right; }
//                 .sender-info h3 { font-family: 'Bricolage Grotesque', sans-serif; font-size: 18px; margin: 0 0 4px 0; color: #000; letter-spacing: 1px; text-transform: uppercase; }
//                 .sender-info p { margin: 0; color: var(--text-muted); font-size: 11px; font-weight: 500;}
//                 .meta-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 40px; margin-bottom: 40px; }
//                 .meta-block { background-color: var(--bg-soft); padding: 24px 30px; border-radius: 12px; border: 1px solid var(--border-color);}
//                 .meta-block h4 { font-family: 'Bricolage Grotesque', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: var(--text-muted); margin: 0 0 16px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; }
//                 .client-name { font-size: 24px; margin: 0 0 8px 0; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 600; color: #000; letter-spacing: -0.01em;}
//                 .meta-block p { margin: 4px 0; color: var(--text-muted); font-size: 12px; font-weight: 500;}
//                 .est-details p { display: flex; justify-content: space-between; border-bottom: 1px dashed var(--border-color); padding: 8px 0; margin: 0; font-size: 12px;}
//                 .est-details p strong { color: #000; font-weight: 600; font-family: 'Inter', sans-serif; }
//                 table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 40px; }
//                 th { background: var(--bg-soft); color: var(--text-muted); font-family: 'Bricolage Grotesque', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; text-align: left; padding: 14px 12px; border-bottom: 1px solid var(--border-color); }
//                 th:first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
//                 th:last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; text-align: right;}
//                 th.text-center { text-align: center; }
//                 td { padding: 24px 12px; border-bottom: 1px solid var(--border-color); vertical-align: top; }
//                 tr:nth-child(even) td { background-color: #fafafa; }
//                 .col-index { width: 3%; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 600; color: var(--text-muted); font-size: 14px;}
//                 .col-img { width: 22%; }
//                 .col-details { width: 35%; }
//                 .col-qty { width: 15%; text-align: center; font-weight: 500; font-size: 12px; color: var(--text-muted);}
//                 .col-moq { width: 10%; text-align: center; font-weight: 600; font-size: 12px;}
//                 .col-price { width: 15%; text-align: right; font-weight: 700; font-size: 16px; color: #000; font-family: 'Inter', sans-serif;}
//                 .img-wrapper { display: flex; gap: 8px; flex-wrap: wrap;}
//                 .product-img { width: 68px; height: 68px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color); box-shadow: 0 2px 4px rgba(0,0,0,0.02);}
//                 .product-name { font-family: 'Bricolage Grotesque', sans-serif; font-size: 16px; font-weight: 600; color: #000; margin-bottom: 8px; text-transform: capitalize; letter-spacing: -0.01em;}
//                 .product-meta { margin-bottom: 10px; display: flex; gap: 8px;}
//                 .meta-pill { background: #fff; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 4px; font-size: 10px; color: var(--text-muted); font-weight: 600; font-family: 'Inter', sans-serif;}
//                 .product-size { font-size: 11px; color: var(--text-muted); line-height: 1.5; font-family: 'Inter', sans-serif; }
//                 .footer { text-align: center; font-size: 11px; color: var(--text-muted); padding-top: 20px; margin-top: auto; font-family: 'Inter', sans-serif;}
//             </style>
//         </head>
//         <body>
//             <div class="document-wrapper">
//                 <div class="header">
//                     <div class="logo-text">
//                         <span class="c-b">B</span><span class="c-h">H</span><span class="c-a">A</span><span class="c-k">K</span><span class="c-t">T</span><span class="c-i">I</span>
//                     </div>
//                     <div class="sender-info">
//                         <h3>Ankit Detroja</h3>
//                         <p>WhatsApp: +91 82387 72094 / +91 9714154356</p>
//                         <p>Email: ankit@bhaktidecor.com</p>
//                         <p>Surat, Gujarat, India</p>
//                     </div>
//                 </div>

//                 <div class="meta-grid">
//                     <div class="meta-block">
//                         <h4>Prepared For</h4>
//                         <h2 class="client-name">${company}</h2>
//                         ${contact ? `<p>${contact}</p>` : ""}
//                         ${emails ? `<p>${emails}</p>` : ""}
//                         ${phone ? `<p>${phone}</p>` : ""}
//                         ${address ? `<p style="margin-top: 8px; max-width: 90%; line-height:1.4;">${address}</p>` : ""}
//                     </div>
//                     <div class="meta-block est-details">
//                         <h4>Estimate Data</h4>
//                         <p><span>Reference Code</span> <strong>EST-${est.id.substring(0,6).toUpperCase()}</strong></p>
//                         <p><span>Date Issued</span> <strong>${new Date(est.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong></p>
//                         <p><span>Valid Until</span> <strong>${new Date(new Date(est.date).getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong></p>
//                         <p style="border-bottom: none; margin-top: 4px;"><span>Total Items Included</span> <strong>${est.products.length}</strong></p>
//                     </div>
//                 </div>

//                 <table>
//                     <thead>
//                         <tr>
//                             <th>#</th>
//                             <th>Media Assets</th>
//                             <th>Product Identification</th>
//                             <th class="text-center">Package Qty</th>
//                             <th class="text-center">Min. Order</th>
//                             <th class="text-right">Price (Export)</th>
//                         </tr>
//                     </thead>
//                     <tbody>
//                         ${rowsHtml}
//                     </tbody>
//                 </table>

//                 <div class="footer">
//                     Thank you for your business. For inquiries regarding this estimation, please reach out to our team.<br>
//                     <strong>Confidential & Proprietary.</strong>
//                 </div>
//             </div>

//             <script>
//                 const link = document.createElement('link');
//                 link.href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=Inter:wght@400;500;600;700&display=swap";
//                 link.rel = "stylesheet";
//                 document.head.appendChild(link);
//                 window.onload = () => { setTimeout(() => { window.print(); }, 1200); };
//             </script>
//         </body>
//         </html>
//     `;

//   const printWin = window.open("", "", "width=1200,height=800");
//   printWin.document.open();
//   printWin.document.write(printContent);
//   printWin.document.close();
// };

// window.confirmDelete = (id, type) => {
//   pendingDelete = { id, type };
//   document.getElementById("confirmModal").classList.add("active");
// };

// document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
//     const btn = document.getElementById("confirmDeleteBtn");
//     btn.innerHTML = '<i class="ti ti-loader ti-spin"></i>';
//     try {
//       await deleteDoc(doc(db, pendingDelete.type, pendingDelete.id));
//       if (pendingDelete.type === "products") loadProducts();
//       if (pendingDelete.type === "categories") loadCategories();
//       if (pendingDelete.type === "customers") loadCustomers();
//       if (pendingDelete.type === "estimations") loadEstimations();
//       document.getElementById("confirmModal").classList.remove("active");
//     } catch (e) {
//       alert("Delete failed.");
//     } finally {
//       btn.innerHTML = "Delete";
//     }
// });