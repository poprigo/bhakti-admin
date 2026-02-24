import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  deleteDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

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

let productsCache = [];
let categoriesCache = [];
let customersCache = [];
let estimationsCache = [];
let selectedFiles = [];
let existingImages = [];
let pendingDelete = { id: null, type: null };

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

document
  .getElementById("logoutBtn")
  .addEventListener("click", () => signOut(auth));

// ==========================================
// DASHBOARD & LIST COUNTS
// ==========================================
function updateDashboard() {
  document.getElementById("dashTotalProducts").innerText = productsCache.length;
  document.getElementById("dashActiveProducts").innerText =
    productsCache.filter((p) => p.isActive).length;
  document.getElementById("dashTotalCustomers").innerText =
    customersCache.length;
  document.getElementById("dashTotalEstimations").innerText =
    estimationsCache.length;

  // Update List Titles with Counts
  document.getElementById("productsTitle").innerText =
    `Products (${productsCache.length})`;
  document.getElementById("categoriesTitle").innerText =
    `Categories (${categoriesCache.length})`;
  document.getElementById("customersTitle").innerText =
    `Customers (${customersCache.length})`;
  document.getElementById("estimationsTitle").innerText =
    `Estimations (${estimationsCache.length})`;

  // Category Dist Bar Chart
  const catCounts = {};
  productsCache.forEach((p) => {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  });
  let statsHtml = "";
  Object.entries(catCounts).forEach(([cat, count]) => {
    const percent =
      productsCache.length === 0 ? 0 : (count / productsCache.length) * 100;
    statsHtml += `<div class="stat-bar-wrapper"><div class="stat-bar-label"><span>${cat}</span><span>${count} Items</span></div><div class="stat-bar-bg"><div class="stat-bar-fill" style="width: ${percent}%"></div></div></div>`;
  });
  document.getElementById("categoryStatsList").innerHTML =
    statsHtml ||
    '<p style="color:var(--text-secondary); font-size:13px;">No product data available yet.</p>';

  // Recent Estimations
  const recentList = document.getElementById("recentEstimationsList");
  let recentHtml = "";
  // Sort by date desc, grab top 4
  const recentEsts = [...estimationsCache]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4);

  if (recentEsts.length === 0) {
    recentHtml =
      '<p style="color:var(--text-secondary); font-size:13px;">No estimations sent yet.</p>';
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
    const group = input.closest(".form-group, .floating-input");
    if (!input.value.trim()) {
      group.classList.add("invalid");
      isValid = false;
    } else {
      group.classList.remove("invalid");
    }
  });

  if (formId === "productForm") {
    const imgGroup = document.getElementById("dropZone").closest(".form-group");
    if (selectedFiles.length === 0 && existingImages.length === 0) {
      imgGroup.classList.add("invalid");
      isValid = false;
    } else {
      imgGroup.classList.remove("invalid");
    }
  }

  form.querySelectorAll("input, textarea, select").forEach((input) => {
    input.addEventListener(
      "input",
      () =>
        input
          .closest(".form-group, .floating-input")
          .classList.remove("invalid"),
      { once: true },
    );
  });
  return isValid;
}

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
      estDropdown.innerHTML =
        '<option value="" disabled selected>No customers...</option>';
      filterDropdown.innerHTML = '<option value="ALL">All Customers</option>';
      updateDashboard();
      return;
    }

    estDropdown.innerHTML =
      '<option value="" disabled selected>Select customer...</option>';
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
    list.innerHTML =
      '<tr><td colspan="4" style="color:#fca5a5; text-align:center;">Failed to load.</td></tr>';
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
            <td style="color:var(--text-secondary);">${data.contactPerson || "-"}</td>
            <td style="color:var(--text-secondary);">${data.phone || "-"}</td>
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

document
  .getElementById("customerForm")
  .addEventListener("submit", async (e) => {
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
            <div class="detail-block"><h4>Contact Person</h4><p style="color:white;">${c.contactPerson || "-"}</p></div>
            <div class="detail-block"><h4>Emails</h4><p style="color:white;">${c.emails || "-"}</p></div>
            <div class="detail-block"><h4>Phone</h4><p style="color:white;">${c.phone || "-"}</p></div>
            <div class="detail-block"><h4>Country</h4><p style="color:white;">${c.country || "-"}</p></div>
            <div class="detail-block" style="grid-column: 1 / -1;"><h4>Website</h4><p style="color:white;">${c.website || "-"}</p></div>
            <div class="detail-block" style="grid-column: 1 / -1;"><h4>Full Address</h4><p style="color:white;">${c.address || "-"}</p></div>
            <div class="detail-block" style="grid-column: 1 / -1;"><h4>Internal Notes</h4><p style="color:white;">${c.notes || "-"}</p></div>
        </div>
    `;
  document.getElementById("viewCustomerModal").classList.add("active");
};

window.editCustomer = (id) => {
  const c = customersCache.find((x) => x.id === id);
  if (!c) return;
  document.getElementById("custFormTitle").innerText = "Edit Customer";
  document.getElementById("custSubmitBtn").innerHTML =
    'Update Customer <i class="ti ti-check"></i>';
  document.getElementById("customerId").value = c.id;
  document.getElementById("custCompany").value = c.companyName || "";
  document.getElementById("custContact").value = c.contactPerson || "";
  document.getElementById("custEmails").value = c.emails || "";
  document.getElementById("custPhone").value = c.phone || "";
  document.getElementById("custCountry").value = c.country || "";
  document.getElementById("custWebsite").value = c.website || "";
  document.getElementById("custAddress").value = c.address || "";
  document.getElementById("custNotes").value = c.notes || "";

  document
    .querySelectorAll(".section")
    .forEach((sec) => sec.classList.remove("active"));
  document.getElementById("addCustomer").classList.add("active");
};

// ==========================================
// CATEGORY MANAGEMENT
// ==========================================
async function loadCategories() {
  const list = document.getElementById("categoryList");
  const dropdown = document.getElementById("productCategory");
  const filterDropdown = document.getElementById("filterProductCat");

  try {
    const snapshot = await getDocs(collection(db, "categories"));
    list.innerHTML = "";
    dropdown.innerHTML =
      '<option value="" disabled selected>Select category...</option>';
    filterDropdown.innerHTML = '<option value="ALL">All Categories</option>';
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
        dropdown.innerHTML += `<option value="${data.name}">${data.name}</option>`;
        filterDropdown.innerHTML += `<option value="${data.name}">${data.name}</option>`;
      }

      const statusBadge = data.isActive
        ? '<span class="badge badge-active">Active</span>'
        : '<span class="badge badge-inactive">Inactive</span>';
      list.innerHTML += `<tr><td style="color: white;">${data.name}</td><td><div class="status-cell"><label class="switch"><input type="checkbox" onchange="window.toggleCategory('${data.id}', ${data.isActive})" ${data.isActive ? "checked" : ""}><span class="slider"></span></label>${statusBadge}</div></td><td><div class="actions-cell"><button class="action-icon" onclick="window.editCategory('${data.id}')"><i class="ti ti-pencil"></i></button><button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'categories')"><i class="ti ti-trash"></i></button></div></td></tr>`;
    });
    updateDashboard();
  } catch (error) {
    list.innerHTML =
      '<tr><td colspan="3" style="color:#fca5a5;">Failed to load.</td></tr>';
  }
}

document
  .getElementById("categoryForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateForm("categoryForm")) return;
    const btn = document.getElementById("catSubmitBtn");
    const id = document.getElementById("categoryId").value;
    const name = document.getElementById("categoryName").value.trim();
    btn.innerHTML = '<i class="ti ti-loader ti-spin"></i>';
    btn.disabled = true;
    try {
      if (id) await updateDoc(doc(db, "categories", id), { name });
      else
        await addDoc(collection(db, "categories"), {
          name,
          isActive: true,
          createdAt: new Date().toISOString(),
        });
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
    filtered = productsCache.filter((p) => p.category === filterCat);
  }

  if (filtered.length === 0) {
    list.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="ti ti-shopping-bag-x"></i><p>No products match this filter.</p></div></td></tr>`;
    return;
  }

  filtered.forEach((data) => {
    const imgUrl = data.images && data.images.length > 0 ? data.images[0] : "";
    const statusBadge = data.isActive
      ? '<span class="badge badge-active">Publish</span>'
      : '<span class="badge badge-inactive">Inactive</span>';
    list.innerHTML += `<tr><td><div class="product-cell">${imgUrl ? `<img src="${imgUrl}" class="img-thumb">` : `<div class="img-thumb" style="display:flex; justify-content:center; align-items:center;"><i class="ti ti-photo-off"></i></div>`}<div class="product-info"><span class="product-title">${data.name}</span><p class="product-desc-text">${data.description || "No description"}</p></div></div></td><td><span class="badge" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #d4d4d8;">${data.category}</span></td><td style="font-weight: 500; font-size: 16px; color: white;">₹${data.priceIndia}</td><td><div class="status-cell"><label class="switch"><input type="checkbox" onchange="window.toggleProduct('${data.id}', ${data.isActive})" ${data.isActive ? "checked" : ""}><span class="slider"></span></label>${statusBadge}</div></td><td><div class="actions-cell"><button class="action-icon" onclick="window.viewProduct('${data.id}')"><i class="ti ti-eye"></i></button><button class="action-icon" onclick="window.editProduct('${data.id}')"><i class="ti ti-pencil"></i></button><button class="action-icon delete" onclick="window.confirmDelete('${data.id}', 'products')"><i class="ti ti-trash"></i></button></div></td></tr>`;
  });
}

async function loadProducts() {
  const list = document.getElementById("productList");
  try {
    const querySnapshot = await getDocs(collection(db, "products"));
    productsCache = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      data.id = docSnap.id;
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
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () =>
  dropZone.classList.remove("dragover"),
);
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
});
window.addEventListener("clearImages", () => {
  selectedFiles = [];
  existingImages = [];
  renderPreviews();
});

function handleFiles(files) {
  selectedFiles = [...selectedFiles, ...Array.from(files)];
  fileInput.value = "";
  document
    .getElementById("dropZone")
    .closest(".form-group")
    .classList.remove("invalid");
  renderPreviews();
}

function renderPreviews() {
  previewContainer.innerHTML = "";
  existingImages.forEach((url, index) => {
    previewContainer.innerHTML += `<div class="preview-item"><img src="${url}"><button type="button" class="remove-btn" onclick="window.removeExistingImage(${index})"><i class="ti ti-x"></i></button></div>`;
  });
  selectedFiles.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewContainer.innerHTML += `<div class="preview-item"><img src="${e.target.result}"><button type="button" class="remove-btn" onclick="window.removeLocalFile(${index})"><i class="ti ti-x"></i></button></div>`;
    };
    reader.readAsDataURL(file);
  });
}
window.removeLocalFile = (index) => {
  selectedFiles.splice(index, 1);
  renderPreviews();
};
window.removeExistingImage = (index) => {
  existingImages.splice(index, 1);
  renderPreviews();
};
async function uploadToCloudinary(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: fd },
  );
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
    for (let i = 0; i < selectedFiles.length; i++)
      finalImageUrls.push(await uploadToCloudinary(selectedFiles[i]));
    const kw = document
      .getElementById("seoKeywords")
      .value.split(",")
      .map((k) => k.trim())
      .filter((k) => k !== "");

    const data = {
      name: document.getElementById("productName").value,
      category: document.getElementById("productCategory").value,
      description: document.getElementById("productDesc").value,
      mfgCost: Number(document.getElementById("costPrice").value),
      priceIndia: Number(document.getElementById("priceIndia").value),
      priceExport: Number(document.getElementById("priceExport").value),
      sizeDetails: document.getElementById("sizeDetails").value,
      hsCode: document.getElementById("hsCode").value,
      gsm: document.getElementById("gsm").value,
      moq: Number(document.getElementById("moq").value),
      qtyInPackage: document.getElementById("qtyInPackage").value,
      seoKeywords: kw,
      images: finalImageUrls,
    };

    if (editId) await updateDoc(doc(db, "products", editId), data);
    else {
      data.isActive = true;
      data.createdAt = new Date().toISOString();
      await addDoc(collection(db, "products"), data);
    }
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

window.viewProduct = (id) => {
  const p = productsCache.find((x) => x.id === id);
  if (!p) return;
  let thumbsHtml = "";
  const mainImg =
    p.images && p.images.length > 0
      ? p.images[0]
      : "https://via.placeholder.com/400";
  if (p.images)
    p.images.forEach(
      (img) =>
        (thumbsHtml += `<img src="${img}" onclick="document.getElementById('mainViewImg').src='${img}'">`),
    );

  document.getElementById("viewModalBody").innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr;">
        <div class="modal-gallery"><img src="${mainImg}" class="main-img-view" id="mainViewImg"><div class="thumb-grid">${thumbsHtml}</div></div>
        <div class="modal-details" style="padding-top: 20px;">
            <span class="modal-cat">${p.category}</span><h2 class="modal-title" style="font-size:24px; margin-bottom: 20px;">${p.name}</h2>
            <div class="modal-price-wrap" style="gap:20px; padding-bottom:20px; margin-bottom:20px;">
                <div class="price-box"><span class="price-label">India</span><span class="price-val" style="color:white; font-size:18px;">₹${p.priceIndia}</span></div>
                <div class="price-box"><span class="price-label">Export</span><span class="price-val" style="font-size:18px;">$${p.priceExport}</span></div>
                <div class="price-box"><span class="price-label">Cost</span><span class="price-val" style="font-size:18px;">₹${p.mfgCost}</span></div>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom: 20px;">
                <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase;">HS Code</h4><p style="color:white; font-size:13px;">${p.hsCode || "-"}</p></div>
                <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase;">MOQ</h4><p style="color:white; font-size:13px;">${p.moq || "-"}</p></div>
                <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase;">GSM</h4><p style="color:white; font-size:13px;">${p.gsm || "-"}</p></div>
                <div><h4 style="font-size:10px; color:var(--text-secondary); text-transform:uppercase;">Package Qty</h4><p style="color:white; font-size:13px;">${p.qtyInPackage || "-"}</p></div>
            </div>
            <div class="detail-block"><h4>Size Details</h4><p>${p.sizeDetails}</p></div>
            <div class="detail-block"><h4>Description</h4><p>${p.description}</p></div>
        </div>
    </div>`;
  document.getElementById("viewModal").classList.add("active");
};

window.editProduct = (id) => {
  const p = productsCache.find((x) => x.id === id);
  if (!p) return;
  document.getElementById("formTitle").innerText = "Edit Product";
  document.getElementById("submitBtn").innerHTML =
    'Update Product <i class="ti ti-check"></i>';
  document.getElementById("productId").value = p.id;
  document.getElementById("productName").value = p.name;
  document.getElementById("productCategory").value = p.category;
  document.getElementById("costPrice").value = p.mfgCost || "";
  document.getElementById("priceIndia").value = p.priceIndia;
  document.getElementById("priceExport").value = p.priceExport;
  document.getElementById("hsCode").value = p.hsCode || "";
  document.getElementById("gsm").value = p.gsm || "";
  document.getElementById("moq").value = p.moq || "";
  document.getElementById("qtyInPackage").value = p.qtyInPackage || "";
  document.getElementById("seoKeywords").value = p.seoKeywords
    ? p.seoKeywords.join(", ")
    : "";
  document.getElementById("sizeDetails").value = p.sizeDetails;
  document.getElementById("productDesc").value = p.description;

  existingImages = p.images || [];
  selectedFiles = [];
  renderPreviews();
  document
    .querySelectorAll(".form-group, .floating-input")
    .forEach((el) => el.classList.remove("invalid"));
  document
    .querySelectorAll(".section")
    .forEach((sec) => sec.classList.remove("active"));
  document.getElementById("addProduct").classList.add("active");
};

// ==========================================
// ESTIMATION WIZARD & FILTERING
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
                <td style="color:white;">${data.products.length} Products</td>
                <td>
                    <div class="actions-cell">
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

let currentEstProducts = [];

window.openCreateEstimation = () => {
  document.getElementById("estCustomerSelect").value = "";
  document.getElementById("estSearchProduct").value = "";
  document.getElementById("estCustError").style.display = "none";
  currentEstProducts = [];
  renderEstProductSelection();

  document.getElementById("step1-ind").classList.add("active");
  document.getElementById("step2-ind").classList.remove("active");
  document.getElementById("estStep1").classList.add("active");
  document.getElementById("estStep2").classList.remove("active");

  document
    .querySelectorAll(".section")
    .forEach((sec) => sec.classList.remove("active"));
  document.getElementById("createEstimation").classList.add("active");
};

function renderEstProductSelection(filterText = "") {
  const list = document.getElementById("estProductSelectionList");
  list.innerHTML = "";
  const filtered = productsCache.filter(
    (p) =>
      p.isActive && p.name.toLowerCase().includes(filterText.toLowerCase()),
  );

  filtered.forEach((p) => {
    const img =
      p.images && p.images.length > 0
        ? p.images[0]
        : "https://via.placeholder.com/50";
    const isSelected = currentEstProducts.find((cp) => cp.id === p.id)
      ? "checked"
      : "";
    const cardClass = isSelected
      ? "selectable-card selected"
      : "selectable-card";
    list.innerHTML += `
            <label class="${cardClass}">
                <input type="checkbox" value="${p.id}" ${isSelected} onchange="toggleEstProduct(this, '${p.id}')">
                <img src="${img}">
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:500; font-size:13px; color:white;">${p.name}</span>
                    <span style="font-size:11px; color:var(--text-secondary);">$${p.priceExport} | MOQ: ${p.moq || "-"}</span>
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
    currentEstProducts.push({ ...p });
  } else {
    card.classList.remove("selected");
    currentEstProducts = currentEstProducts.filter((x) => x.id !== id);
  }
};

window.goToEstStep2 = () => {
  if (!document.getElementById("estCustomerSelect").value) {
    document.getElementById("estCustError").style.display = "block";
    return;
  }
  if (currentEstProducts.length === 0) {
    alert("Please select at least one product.");
    return;
  }

  document.getElementById("estCustError").style.display = "none";
  document.getElementById("step1-ind").classList.remove("active");
  document.getElementById("step2-ind").classList.add("active");
  document.getElementById("estStep1").classList.remove("active");
  document.getElementById("estStep2").classList.add("active");

  const tbody = document.getElementById("estEditableTableBody");
  tbody.innerHTML = "";
  currentEstProducts.forEach((p, index) => {
    tbody.innerHTML += `
            <tr>
                <td style="font-size:12px; font-weight:500; color:white;">${p.name}</td>
                <td><input type="number" id="estMoq_${index}" value="${p.moq || 0}" style="width:80px; color:white;"></td>
                <td><input type="text" id="estQty_${index}" value="${p.qtyInPackage || ""}" style="width:120px; color:white;"></td>
                <td><input type="number" step="0.01" id="estPrice_${index}" value="${p.priceExport || 0}" style="width:100px; color:white;"></td>
            </tr>
        `;
  });
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

  currentEstProducts.forEach((p, index) => {
    p.estMoq = document.getElementById(`estMoq_${index}`).value;
    p.estQtyInPackage = document.getElementById(`estQty_${index}`).value;
    p.estPriceExport = document.getElementById(`estPrice_${index}`).value;
  });

  const custId = document.getElementById("estCustomerSelect").value;
  const cust = customersCache.find((c) => c.id === custId);

  const estData = {
    customerId: cust.id,
    customerName: cust.companyName,
    date: new Date().toISOString(),
    products: currentEstProducts,
  };

  try {
    const docRef = await addDoc(collection(db, "estimations"), estData);
    loadEstimations();
    document.querySelectorAll(".nav-btn")[1].click();
    printEstimation(docRef.id);
  } catch (err) {
    alert("Error saving estimation.");
  } finally {
    btn.innerHTML = 'Save & Generate <i class="ti ti-file-invoice"></i>';
    btn.disabled = false;
  }
};

// ==========================================
// 100% REDESIGNED PRINT ENGINE (Award-Winning B2B Style)
// ==========================================
window.printEstimation = (id) => {
  const est = estimationsCache.find((e) => e.id === id);
  if (!est) return;

  // Pull full customer details
  const cust = customersCache.find((c) => c.id === est.customerId);
  const company = cust ? cust.companyName : est.customerName;
  const contact = cust && cust.contactPerson ? cust.contactPerson : "";
  const phone = cust && cust.phone ? cust.phone : "";
  const address = cust && cust.address ? cust.address : "";
  const emails = cust && cust.emails ? cust.emails : "";

  let rowsHtml = "";
  est.products.forEach((p, index) => {
    let imagesGrid = "";
    if (p.images && p.images.length > 0) {
      const imagesToShow = p.images.slice(0, 3);
      imagesToShow.forEach((img) => {
        imagesGrid += `<img src="${img}" class="product-img">`;
      });
    }

    rowsHtml += `
            <tr>
                <td class="col-index">${String(index + 1).padStart(2, "0")}</td>
                <td class="col-img"><div class="img-wrapper">${imagesGrid}</div></td>
                <td class="col-details">
                    <div class="product-name">${p.name}</div>
                    <div class="product-meta">
                        <span class="meta-pill">HS CODE: ${p.hsCode || "-"}</span>
                        <span class="meta-pill">GSM: ${p.gsm || "-"}</span>
                    </div>
                    <div class="product-size">${p.sizeDetails || "-"}</div>
                </td>
                <td class="col-qty">${p.estQtyInPackage || "-"}</td>
                <td class="col-moq">${p.estMoq || "-"}</td>
                <td class="col-price">$${p.estPriceExport || "-"}</td>
            </tr>
        `;
  });

  const printContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Estimate - ${company}</title>
            <style>
                /* The font will be explicitly injected here by the script below */
                :root {
                    --text-main: #000000;
                    --text-muted: #52525b;
                    --border-color: #e4e4e7;
                    --bg-soft: #f4f4f5;
                }

                * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

                body { font-family: 'Inter', sans-serif; color: var(--text-main); margin: 0; padding: 40px; font-size: 12px; line-height: 1.5; background: #fff; }

                @page { size: A4 landscape; margin: 12mm; }

                .document-wrapper { display: flex; flex-direction: column; min-height: 90vh; }

                /* HEADER: Corporate Minimalist */
                .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 30px; border-bottom: 1px solid var(--border-color); margin-bottom: 40px; }
                .logo-text { font-family: 'Bricolage Grotesque', sans-serif; font-size: 40px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; line-height: 1; margin: 0; }
                /* Bhakti Colors */
                .c-b { color: #2e3192; } .c-h { color: #8cc63f; } .c-a { color: #f15a24; } .c-k { color: #f7931e; } .c-t { color: #009245; } .c-i { color: #1c75bc; }
                
                .sender-info { text-align: right; }
                .sender-info h3 { font-family: 'Bricolage Grotesque', sans-serif; font-size: 18px; margin: 0 0 4px 0; color: #000; letter-spacing: 1px; text-transform: uppercase; }
                .sender-info p { margin: 0; color: var(--text-muted); font-size: 11px; font-weight: 500;}

                /* META SECTION */
                .meta-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 40px; margin-bottom: 40px; }
                .meta-block { background-color: var(--bg-soft); padding: 24px 30px; border-radius: 12px; border: 1px solid var(--border-color);}
                .meta-block h4 { font-family: 'Bricolage Grotesque', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: var(--text-muted); margin: 0 0 16px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; }
                .client-name { font-size: 24px; margin: 0 0 8px 0; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 600; color: #000; letter-spacing: -0.01em;}
                .meta-block p { margin: 4px 0; color: var(--text-muted); font-size: 12px; font-weight: 500;}

                .est-details p { display: flex; justify-content: space-between; border-bottom: 1px dashed var(--border-color); padding: 8px 0; margin: 0; font-size: 12px;}
                .est-details p strong { color: #000; font-weight: 600; font-family: 'Inter', sans-serif; }

                /* TABLE DESIGN */
                table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 40px; }
                th { background: var(--bg-soft); color: var(--text-muted); font-family: 'Bricolage Grotesque', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; text-align: left; padding: 14px 12px; border-bottom: 1px solid var(--border-color); }
                th:first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
                th:last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; text-align: right;}
                th.text-center { text-align: center; }
                
                td { padding: 24px 12px; border-bottom: 1px solid var(--border-color); vertical-align: top; }
                tr:nth-child(even) td { background-color: #fafafa; }
                
                .col-index { width: 3%; font-family: 'Bricolage Grotesque', sans-serif; font-weight: 600; color: var(--text-muted); font-size: 14px;}
                .col-img { width: 22%; }
                .col-details { width: 35%; }
                .col-qty { width: 15%; text-align: center; font-weight: 500; font-size: 12px; color: var(--text-muted);}
                .col-moq { width: 10%; text-align: center; font-weight: 600; font-size: 12px;}
                .col-price { width: 15%; text-align: right; font-weight: 700; font-size: 16px; color: #000; font-family: 'Inter', sans-serif;}

                .img-wrapper { display: flex; gap: 8px; flex-wrap: wrap;}
                .product-img { width: 68px; height: 68px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color); box-shadow: 0 2px 4px rgba(0,0,0,0.02);}
                
                .product-name { font-family: 'Bricolage Grotesque', sans-serif; font-size: 16px; font-weight: 600; color: #000; margin-bottom: 8px; text-transform: capitalize; letter-spacing: -0.01em;}
                .product-meta { margin-bottom: 10px; display: flex; gap: 8px;}
                .meta-pill { background: #fff; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 4px; font-size: 10px; color: var(--text-muted); font-weight: 600; font-family: 'Inter', sans-serif;}
                
                .product-size { font-size: 11px; color: var(--text-muted); line-height: 1.5; font-family: 'Inter', sans-serif; }

                /* FOOTER */
                .footer { text-align: center; font-size: 11px; color: var(--text-muted); padding-top: 20px; margin-top: auto; font-family: 'Inter', sans-serif;}
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
                        <h4>Prepared For</h4>
                        <h2 class="client-name">${company}</h2>
                        ${contact ? `<p>${contact}</p>` : ""}
                        ${emails ? `<p>${emails}</p>` : ""}
                        ${phone ? `<p>${phone}</p>` : ""}
                        ${address ? `<p style="margin-top: 8px; max-width: 90%; line-height:1.4;">${address}</p>` : ""}
                    </div>
                    <div class="meta-block est-details">
                        <h4>Estimate Data</h4>
                        <p><span>Date Issued</span> <strong>${new Date(est.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong></p>
                        <p><span>Valid Until</span> <strong>${new Date(new Date(est.date).getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong></p>
                        <p style="border-bottom: none; margin-top: 4px;"><span>Total Items Included</span> <strong>${est.products.length}</strong></p>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Media Assets</th>
                            <th>Product Identification</th>
                            <th class="text-center">Package Qty</th>
                            <th class="text-center">Min. Order</th>
                            <th class="text-right">Price (Export)</th>
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
                // 1. Inject the Google Fonts directly into the document head to bypass print-blockers
                const link = document.createElement('link');
                link.href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=Inter:wght@400;500;600;700&display=swap";
                link.rel = "stylesheet";
                document.head.appendChild(link);

                // 2. Strict delay to force browser to render fonts and images before the print thread locks
                window.onload = () => {
                    setTimeout(() => {
                        window.print();
                    }, 1200); // 1.2 second wait guarantees Bricolage and Inter load perfectly
                };
            </script>
        </body>
        </html>
    `;

  const printWin = window.open("", "", "width=1200,height=800");
  printWin.document.open();
  printWin.document.write(printContent);
  printWin.document.close();
};

// Confirm Delete
window.confirmDelete = (id, type) => {
  pendingDelete = { id, type };
  document.getElementById("confirmModal").classList.add("active");
};

document
  .getElementById("confirmDeleteBtn")
  .addEventListener("click", async () => {
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
