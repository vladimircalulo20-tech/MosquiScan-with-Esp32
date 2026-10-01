// ============================================================
// MOSQUISCAN
// Smartphone + AI + ESP32 + Geospatial Mapping
// ============================================================

// 1. PUT YOUR TEACHABLE MACHINE MODEL URL HERE.
// Example:
// https://teachablemachine.withgoogle.com/models/XXXXXXXXX/
const MODEL_URL = "PASTE_YOUR_TEACHABLE_MACHINE_MODEL_URL_HERE/";

// 2. PUT YOUR ESP32 LOCAL IP HERE.
// Example: "192.168.1.45"
// Leave empty until you know the ESP32 IP.
const ESP32_IP = "";

const STORAGE_KEY = "mosquiscanRecords";

let model = null;
let currentImageData = "";
let currentAIResult = "";
let currentConfidence = 0;
let selectedLocationMarker = null;

// ------------------------------------------------------------
// ELEMENTS
// ------------------------------------------------------------
const imageInput = document.getElementById("imageInput");
const previewWrap = document.getElementById("previewWrap");
const previewImage = document.getElementById("previewImage");
const classifyButton = document.getElementById("classifyButton");
const sendLedButton = document.getElementById("sendLedButton");
const saveButton = document.getElementById("saveButton");

const aiResult = document.getElementById("aiResult");
const confidence = document.getElementById("confidence");
const reason = document.getElementById("reason");
const systemMessage = document.getElementById("systemMessage");

const latitudeInput = document.getElementById("latitude");
const longitudeInput = document.getElementById("longitude");
const notesInput = document.getElementById("notes");

const totalRecords = document.getElementById("totalRecords");
const possibleSites = document.getElementById("possibleSites");
const notPossibleSites = document.getElementById("notPossibleSites");

const espStatus = document.getElementById("espStatus");
const espDot = document.getElementById("espDot");

// ------------------------------------------------------------
// MAP
// ------------------------------------------------------------
const map = L.map("map").setView([9.8190, 124.4970], 15);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

map.on("click", function (event) {
  setLocation(event.latlng.lat, event.latlng.lng);
});

function setLocation(lat, lng) {
  latitudeInput.value = Number(lat).toFixed(6);
  longitudeInput.value = Number(lng).toFixed(6);

  if (selectedLocationMarker) {
    map.removeLayer(selectedLocationMarker);
  }

  selectedLocationMarker = L.marker([lat, lng])
    .addTo(map)
    .bindPopup("Selected inspection location")
    .openPopup();

  map.setView([lat, lng], 17);
}

// ------------------------------------------------------------
// IMAGE INPUT
// ------------------------------------------------------------
imageInput.addEventListener("change", function () {
  const file = imageInput.files[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = function (event) {
    currentImageData = event.target.result;
    previewImage.src = currentImageData;
    previewWrap.classList.remove("hidden");

    classifyButton.disabled = false;
    saveButton.disabled = true;
    sendLedButton.disabled = true;

    currentAIResult = "";
    currentConfidence = 0;

    aiResult.textContent = "Image ready. Tap Analyze Image.";
    aiResult.className = "result waiting";
    confidence.textContent = "—";
    reason.textContent = "The image is ready for AI classification.";

    showMessage("Image loaded successfully.", "normal");
  };

  reader.readAsDataURL(file);
});

// ------------------------------------------------------------
// AI MODEL
// ------------------------------------------------------------
async function loadAIModel() {
  if (!MODEL_URL || MODEL_URL.includes("PASTE_YOUR")) {
    showMessage("Add your Teachable Machine MODEL_URL in script.js first.", "error");
    return;
  }

  try {
    model = await tmImage.load(
      MODEL_URL + "model.json",
      MODEL_URL + "metadata.json"
    );

    showMessage("AI model loaded successfully.", "normal");
  } catch (error) {
    console.error(error);
    showMessage("Could not load the AI model. Check your model URL.", "error");
  }
}

classifyButton.addEventListener("click", async function () {
  if (!model) {
    showMessage("AI model is not loaded yet.", "error");
    return;
  }

  if (!currentImageData) {
    showMessage("Please capture or upload an image first.", "error");
    return;
  }

  classifyButton.disabled = true;
  aiResult.textContent = "Analyzing...";
  aiResult.className = "result waiting";
  reason.textContent = "The AI is analyzing the image.";

  try {
    const prediction = await model.predict(previewImage);

    let best = prediction[0];

    for (const item of prediction) {
      if (item.probability > best.probability) {
        best = item;
      }
    }

    const normalized = best.className.toLowerCase().trim();

    // Recommended class names:
    // "Possible Breeding Site"
    // "Not a Possible Breeding Site"

    if (normalized.includes("not") && normalized.includes("possible")) {
      currentAIResult = "Not a Possible Breeding Site";
    } else if (normalized.includes("possible")) {
      currentAIResult = "Possible Breeding Site";
    } else {
      currentAIResult = best.className;
    }

    currentConfidence = best.probability;

    aiResult.textContent = currentAIResult;
    confidence.textContent = (currentConfidence * 100).toFixed(2) + "%";

    if (currentAIResult === "Possible Breeding Site") {
      aiResult.className = "result possible";
      reason.textContent =
        "The image shows visual conditions that may be associated with a potential mosquito-breeding site, such as standing or stagnant water retained in a suitable water-holding area. Human verification is still required.";
    } else if (currentAIResult === "Not a Possible Breeding Site") {
      aiResult.className = "result not-possible";
      reason.textContent =
        "The image does not show clear visual conditions associated with a potential mosquito-breeding site. Water alone does not necessarily indicate a potential breeding site.";
    } else {
      aiResult.className = "result waiting";
      reason.textContent =
        "The model returned a class that does not match the expected MosquiScan class labels.";
    }

    sendLedButton.disabled = false;
    saveButton.disabled = false;

    showMessage("AI classification completed.", "normal");

    // Automatically send the result to the ESP32.
    await sendResultToESP32();

  } catch (error) {
    console.error(error);
    showMessage("AI classification failed. Check the image and model.", "error");
    aiResult.textContent = "Classification Error";
    aiResult.className = "result waiting";
  } finally {
    classifyButton.disabled = false;
  }
});

// ------------------------------------------------------------
// ESP32
// ------------------------------------------------------------
async function sendResultToESP32() {
  if (!ESP32_IP) {
    setESPStatus("Not Configured", "error");
    showMessage("ESP32 IP is empty. Add its IP address in script.js.", "normal");
    return false;
  }

  if (!currentAIResult) {
    showMessage("Classify an image first.", "error");
    return false;
  }

  let endpoint = "";

  if (currentAIResult === "Possible Breeding Site") {
    endpoint = "/possible";
  } else if (currentAIResult === "Not a Possible Breeding Site") {
    endpoint = "/not-possible";
  } else {
    showMessage("The AI result does not match the ESP32 commands.", "error");
    return false;
  }

  try {
    const response = await fetch("http://" + ESP32_IP + endpoint, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("ESP32 returned HTTP " + response.status);
    }

    const text = await response.text();

    setESPStatus("Connected", "connected");
    showMessage("ESP32 received: " + text, "normal");
    return true;

  } catch (error) {
    console.error(error);
    setESPStatus("Connection Failed", "error");
    showMessage(
      "Could not connect to ESP32. Check Wi-Fi, IP address, and browser security.",
      "error"
    );
    return false;
  }
}

sendLedButton.addEventListener("click", sendResultToESP32);

async function testESP32() {
  if (!ESP32_IP) {
    setESPStatus("Not Configured", "error");
    return;
  }

  try {
    const response = await fetch("http://" + ESP32_IP + "/off", {
      cache: "no-store"
    });

    if (!response.ok) throw new Error("ESP32 not responding");

    setESPStatus("Connected", "connected");
  } catch (error) {
    setESPStatus("Connection Failed", "error");
  }
}

function setESPStatus(text, state) {
  espStatus.textContent = "ESP32: " + text;
  espDot.className = "status-dot " + state;
}

// ------------------------------------------------------------
// CURRENT LOCATION
// ------------------------------------------------------------
document.getElementById("locationButton").addEventListener("click", function () {
  if (!navigator.geolocation) {
    showMessage("Geolocation is not supported by this browser.", "error");
    return;
  }

  showMessage("Getting your current smartphone location...", "normal");

  navigator.geolocation.getCurrentPosition(
    function (position) {
      setLocation(
        position.coords.latitude,
        position.coords.longitude
      );

      showMessage("Current smartphone location added to the map.", "normal");
    },
    function () {
      showMessage(
        "Location access was denied or unavailable. You can click the map manually.",
        "error"
      );
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
});

document.getElementById("clearLocationButton").addEventListener("click", function () {
  latitudeInput.value = "";
  longitudeInput.value = "";

  if (selectedLocationMarker) {
    map.removeLayer(selectedLocationMarker);
    selectedLocationMarker = null;
  }
});

// ------------------------------------------------------------
// SAVE RECORD
// ------------------------------------------------------------
saveButton.addEventListener("click", function () {
  if (!currentImageData) {
    showMessage("Please add an inspection image.", "error");
    return;
  }

  if (!currentAIResult) {
    showMessage("Please classify the image first.", "error");
    return;
  }

  const record = {
    id: generateInspectionID(),
    image: currentImageData,
    result: currentAIResult,
    confidence: currentConfidence,
    latitude: latitudeInput.value || "",
    longitude: longitudeInput.value || "",
    date: new Date().toLocaleString(),
    notes: notesInput.value.trim(),
    reason: reason.textContent
  };

  const records = getRecords();
  records.unshift(record);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    showMessage(
      "The image is too large for browser storage. Use a smaller image.",
      "error"
    );
    return;
  }

  updateDashboard();
  displayRecords();
  displayMapMarkers();

  showMessage("Inspection record saved successfully.", "normal");
});

// ------------------------------------------------------------
// RECORDS
// ------------------------------------------------------------
function getRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function generateInspectionID() {
  const records = getRecords();
  return "MS-" + String(records.length + 1).padStart(4, "0");
}

function updateDashboard() {
  const records = getRecords();

  totalRecords.textContent = records.length;

  possibleSites.textContent = records.filter(
    record => record.result === "Possible Breeding Site"
  ).length;

  notPossibleSites.textContent = records.filter(
    record => record.result === "Not a Possible Breeding Site"
  ).length;
}

function displayRecords() {
  const records = getRecords();
  const list = document.getElementById("recordsList");

  if (!records.length) {
    list.innerHTML = '<div class="empty-state">No inspection records yet.</div>';
    return;
  }

  list.innerHTML = records.map(record => {
    const resultClass =
      record.result === "Possible Breeding Site"
        ? "possible-text"
        : "not-possible-text";

    return `
      <article class="record">
        <img src="${record.image}" alt="Inspection image">
        <div>
          <div class="record-id">${escapeHTML(record.id)}</div>
          <h3 class="${resultClass}">${escapeHTML(record.result)}</h3>
          <p><b>Confidence:</b> ${(record.confidence * 100).toFixed(2)}%</p>
          <p><b>Location:</b> ${escapeHTML(record.latitude || "Not set")},
             ${escapeHTML(record.longitude || "Not set")}</p>
          <p><b>Date:</b> ${escapeHTML(record.date)}</p>
          <p><b>Notes:</b> ${escapeHTML(record.notes || "None")}</p>
        </div>
        <div>
          <button class="danger-outline" onclick="deleteRecord('${record.id}')">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

function deleteRecord(id) {
  const records = getRecords().filter(record => record.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  updateDashboard();
  displayRecords();
  displayMapMarkers();
}

document.getElementById("clearRecordsButton").addEventListener("click", function () {
  if (!confirm("Delete all MosquiScan inspection records?")) return;

  localStorage.removeItem(STORAGE_KEY);
  updateDashboard();
  displayRecords();
  displayMapMarkers();

  showMessage("All inspection records were deleted.", "normal");
});

// ------------------------------------------------------------
// MAP MARKERS
// ------------------------------------------------------------
function displayMapMarkers() {
  map.eachLayer(function (layer) {
    if (
      layer instanceof L.CircleMarker ||
      (layer instanceof L.Marker && layer !== selectedLocationMarker)
    ) {
      map.removeLayer(layer);
    }
  });

  const records = getRecords();

  records.forEach(record => {
    const lat = parseFloat(record.latitude);
    const lng = parseFloat(record.longitude);

    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    const isPossible = record.result === "Possible Breeding Site";
    const markerColor = isPossible ? "red" : "green";

    const marker = L.circleMarker([lat, lng], {
      radius: 9,
      color: markerColor,
      fillColor: markerColor,
      fillOpacity: 0.8,
      weight: 2
    }).addTo(map);

    const popupImage = record.image
      ? `<img src="${record.image}" style="width:160px;height:100px;object-fit:cover;border-radius:8px;display:block;margin:0 auto 8px;">`
      : "";

    marker.bindPopup(`
      <div style="text-align:center;max-width:210px;">
        ${popupImage}
        <strong>${escapeHTML(record.result)}</strong>
        <br><br>
        <b>ID:</b> ${escapeHTML(record.id)}
        <br>
        <b>Latitude:</b> ${escapeHTML(record.latitude)}
        <br>
        <b>Longitude:</b> ${escapeHTML(record.longitude)}
        <br>
        <b>Date:</b> ${escapeHTML(record.date)}
        <br><br>
        ${escapeHTML(record.notes || "")}
      </div>
    `);
  });
}

// ------------------------------------------------------------
// UTILITIES
// ------------------------------------------------------------
function showMessage(text, type) {
  systemMessage.textContent = text;
  systemMessage.style.color = type === "error" ? "#dc2626" : "#64748b";
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ------------------------------------------------------------
// START
// ------------------------------------------------------------
async function initializeMosquiScan() {
  updateDashboard();
  displayRecords();
  displayMapMarkers();

  await loadAIModel();
  await testESP32();

  console.log("MosquiScan initialized.");
}

initializeMosquiScan();

