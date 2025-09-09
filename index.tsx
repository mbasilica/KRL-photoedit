/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality } from "@google/genai";

// --- DOM Element References ---
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const uploadBtn = document.getElementById('upload-btn') as HTMLButtonElement;
const cameraBtn = document.getElementById('camera-btn') as HTMLButtonElement;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const imageContainer = document.getElementById('image-container') as HTMLDivElement;
const originalImage = document.getElementById('original-image') as HTMLImageElement;
const resultContainer = document.getElementById('result-container') as HTMLDivElement;
const resultText = document.getElementById('result-text') as HTMLParagraphElement;
const loader = document.getElementById('loader') as HTMLDivElement;
const loaderText = document.getElementById('loader-text') as HTMLParagraphElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const blendingControls = document.getElementById('blending-controls') as HTMLElement;
const opacitySlider = document.getElementById('opacity-slider') as HTMLInputElement;
const imageBlender = document.getElementById('image-blender') as HTMLDivElement;
const resultImageBg = document.getElementById('result-image-bg') as HTMLImageElement;
const resultImageFg = document.getElementById('result-image-fg') as HTMLImageElement;
const cameraModal = document.getElementById('camera-modal') as HTMLDivElement;
const cameraView = document.getElementById('camera-view') as HTMLVideoElement;
const cameraCanvas = document.getElementById('camera-canvas') as HTMLCanvasElement;
const snapBtn = document.getElementById('snap-btn') as HTMLButtonElement;
const cancelCameraBtn = document.getElementById('cancel-camera-btn') as HTMLButtonElement;
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;


// --- State Management ---
interface EditState {
  originalImageBase64: string;
  originalImageType: string;
  editedImageBase64: string;
  editedImageType: string;
  prompt: string;
  responseText?: string;
}

let uploadedImageBase64: string | null = null;
let uploadedImageType: string | null = null;
let loadingIntervalId: number | null = null;
let mediaStream: MediaStream | null = null;
const loadingMessages = [
  "Warming up the AI's paintbrush...",
  "Analyzing your photo...",
  "Applying creative edits...",
  "Adding the finishing touches...",
  "Almost there..."
];
let editHistory: EditState[] = [];
let historyIndex = -1;

// --- Gemini API Initialization ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

// --- Event Listeners ---
uploadBtn.addEventListener('click', () => fileInput.click());
cameraBtn.addEventListener('click', openCamera);
fileInput.addEventListener('change', handleFileSelect);
promptInput.addEventListener('input', updateGenerateButtonState);
generateBtn.addEventListener('click', handleImageGeneration);
downloadBtn.addEventListener('click', downloadResultImage);
opacitySlider.addEventListener('input', handleOpacityChange);
snapBtn.addEventListener('click', takePicture);
cancelCameraBtn.addEventListener('click', closeCamera);
undoBtn.addEventListener('click', handleUndo);
redoBtn.addEventListener('click', handleRedo);


// Drag and Drop Listeners
imageContainer.addEventListener('dragover', (e) => {
  e.preventDefault();
  imageContainer.classList.add('dragover');
});

imageContainer.addEventListener('dragleave', () => {
  imageContainer.classList.remove('dragover');
});

imageContainer.addEventListener('drop', (e) => {
  e.preventDefault();
  imageContainer.classList.remove('dragover');
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
});

// Keyboard shortcuts for undo/redo
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    undoBtn.click();
  }
  if (e.ctrlKey && e.key === 'y') {
    e.preventDefault();
    redoBtn.click();
  }
});


// --- Core Functions ---

/**
 * Handles the file selection from the input element.
 */
function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    handleFile(target.files[0]);
  }
}

/**
 * Processes the selected file, validates it, and displays a preview.
 * @param file The image file to process.
 */
function handleFile(file: File) {
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target?.result as string;
    displayOriginalImage(dataUrl, file.type);
  };
  reader.readAsDataURL(file);
}

/**
 * Displays the selected image (from file or camera) and resets the UI and history.
 * @param dataUrl The base64 data URL of the image.
 * @param mimeType The MIME type of the image.
 */
function displayOriginalImage(dataUrl: string, mimeType: string) {
  uploadedImageBase64 = dataUrl.split(',')[1];
  uploadedImageType = mimeType;

  originalImage.src = dataUrl;
  originalImage.classList.remove('hidden');
  imageContainer.querySelector('.placeholder')?.classList.add('hidden');
  
  // Hide results from previous run and reset history
  blendingControls.classList.add('hidden');
  downloadBtn.disabled = true;
  imageBlender.classList.add('hidden');
  resultText.textContent = '';
  resultContainer.querySelector('.placeholder')?.classList.remove('hidden');
  
  editHistory = [];
  historyIndex = -1;
  updateHistoryButtonStates();
  updateGenerateButtonState();
}


/**
 * Checks if both an image and a prompt are provided and updates the generate button's state.
 */
function updateGenerateButtonState() {
  const promptText = promptInput.value.trim();
  generateBtn.disabled = !uploadedImageBase64 || !promptText;
}

/**
 * Handles the main image generation process by calling the Gemini API.
 */
async function handleImageGeneration() {
  if (!uploadedImageBase64 || !uploadedImageType) {
    alert('Please upload an image first.');
    return;
  }

  const prompt = promptInput.value.trim();
  if (!prompt) {
    alert('Please enter a prompt to describe your edits.');
    return;
  }

  setLoading(true);
  blendingControls.classList.add('hidden');

  try {
    const imagePart = {
      inlineData: { data: uploadedImageBase64, mimeType: uploadedImageType },
    };
    const textPart = { text: prompt };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image-preview',
      contents: { parts: [imagePart, textPart] },
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    const parts = response.candidates?.[0]?.content.parts;
    if (!parts) {
        resultText.textContent = "No content was generated. The model may have refused the prompt.";
        return;
    }
    
    let newEditedImageBase64: string | null = null;
    let newEditedImageType: string | null = null;
    let responseText: string | undefined;

    for (const part of parts) {
      if (part.inlineData?.data) {
        newEditedImageBase64 = part.inlineData.data;
        newEditedImageType = part.inlineData.mimeType;
      } else if (part.text) {
        responseText = part.text;
      }
    }

    if (newEditedImageBase64 && newEditedImageType) {
      // Truncate history if we've undone
      editHistory = editHistory.slice(0, historyIndex + 1);
      
      // FIX: Use `uploadedImageBase64` and `uploadedImageType` which hold the state for the current operation.
      const newState: EditState = {
        originalImageBase64: uploadedImageBase64,
        originalImageType: uploadedImageType,
        editedImageBase64: newEditedImageBase64,
        editedImageType: newEditedImageType,
        prompt: prompt,
        responseText: responseText
      };

      editHistory.push(newState);
      historyIndex = editHistory.length - 1;

      displayState(newState);
      updateHistoryButtonStates();
    } else {
      resultText.textContent = "The model returned a text response but no image. Try rephrasing your prompt.";
    }


  } catch (error) {
    console.error(error);
    alert(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
    resultText.textContent = 'Failed to generate image. Please try again.';
  } finally {
    setLoading(false);
  }
}

/**
 * Displays a given edit state in the UI.
 * @param state The EditState object to display.
 */
function displayState(state: EditState) {
  // Update original image source for the blender background
  const originalSrc = `data:${state.originalImageType};base64,${state.originalImageBase64}`;
  originalImage.src = originalSrc;
  resultImageBg.src = originalSrc;
  
  // Update the edited image
  resultImageFg.src = `data:${state.editedImageType};base64,${state.editedImageBase64}`;
  
  // Update prompt and text
  promptInput.value = state.prompt;
  resultText.textContent = state.responseText || '';
  
  // Reset slider and opacity
  opacitySlider.value = '100';
  resultImageFg.style.opacity = '1';

  // Show the result components
  imageBlender.classList.remove('hidden');
  downloadBtn.disabled = false;
  blendingControls.classList.remove('hidden');
  resultContainer.querySelector('.placeholder')?.classList.add('hidden');
  
  updateGenerateButtonState();
}

/**
 * Shows or hides the loading indicator and disables/enables controls.
 * @param isLoading Whether to show the loading state.
 */
function setLoading(isLoading: boolean) {
  loader.classList.toggle('hidden', !isLoading);
  generateBtn.disabled = isLoading;
  promptInput.disabled = isLoading;

  if (loadingIntervalId) {
    clearInterval(loadingIntervalId);
    loadingIntervalId = null;
  }

  if (isLoading) {
    let currentMessageIndex = 0;
    loaderText.textContent = loadingMessages[currentMessageIndex];
    loaderText.style.opacity = '1';

    loadingIntervalId = window.setInterval(() => {
      currentMessageIndex = (currentMessageIndex + 1) % loadingMessages.length;
      
      // Fade out
      loaderText.style.opacity = '0';
      
      // Wait for fade out to complete, then change text and fade in
      setTimeout(() => {
        loaderText.textContent = loadingMessages[currentMessageIndex];
        loaderText.style.opacity = '1';
      }, 500); // This duration should match the CSS transition
    }, 2500);
  } else {
    // Reset for the next time
    loaderText.textContent = "Generating your image...";
    loaderText.style.opacity = '1';
  }
}

/**
 * Updates the opacity of the foreground (edited) image based on the slider value.
 */
function handleOpacityChange() {
  const opacity = parseInt(opacitySlider.value) / 100;
  resultImageFg.style.opacity = opacity.toString();
}


/**
 * Triggers a download of the generated image, blended with the original.
 */
async function downloadResultImage() {
    if (resultImageFg.src && !imageBlender.classList.contains('hidden')) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Use promises to ensure images are loaded before drawing
        const bgImage = new Image();
        bgImage.src = resultImageBg.src;
        await new Promise(resolve => { bgImage.onload = resolve; bgImage.onerror = resolve; });
        
        const fgImage = new Image();
        fgImage.src = resultImageFg.src;
        await new Promise(resolve => { fgImage.onload = resolve; fgImage.onerror = resolve; });

        // Set canvas dimensions to the background image's natural dimensions
        canvas.width = bgImage.naturalWidth;
        canvas.height = bgImage.naturalHeight;

        // Draw background image (original)
        ctx.drawImage(bgImage, 0, 0);

        // Set opacity and draw foreground image (edited), scaled to fit the canvas
        ctx.globalAlpha = parseInt(opacitySlider.value) / 100;
        ctx.drawImage(fgImage, 0, 0, canvas.width, canvas.height);

        // Trigger download
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png'); // Get data URL from canvas
        a.download = 'blended-image.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

// --- History Functions ---
function updateHistoryButtonStates() {
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = historyIndex >= editHistory.length - 1;
}

function handleUndo() {
    if (historyIndex > 0) {
        historyIndex--;
        displayState(editHistory[historyIndex]);
        updateHistoryButtonStates();
    }
}

function handleRedo() {
    if (historyIndex < editHistory.length - 1) {
        historyIndex++;
        displayState(editHistory[historyIndex]);
        updateHistoryButtonStates();
    }
}

// --- Camera Functions ---

/**
 * Opens the camera modal and requests camera access.
 */
async function openCamera() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
            cameraModal.classList.remove('hidden');
            cameraView.srcObject = mediaStream;
        } catch (err) {
            console.error("Error accessing camera: ", err);
            alert("Could not access the camera. Please ensure you have a camera connected and have granted permission.");
        }
    } else {
        alert("Camera API not supported by your browser.");
    }
}

/**
 * Closes the camera modal and stops the media stream.
 */
function closeCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    cameraModal.classList.add('hidden');
    cameraView.srcObject = null;
}

/**
 * Captures a photo from the camera view and displays it.
 */
function takePicture() {
    const context = cameraCanvas.getContext('2d');
    if (context) {
        cameraCanvas.width = cameraView.videoWidth;
        cameraCanvas.height = cameraView.videoHeight;
        context.drawImage(cameraView, 0, 0, cameraCanvas.width, cameraCanvas.height);
        
        const dataUrl = cameraCanvas.toDataURL('image/png');
        displayOriginalImage(dataUrl, 'image/png');
        
        closeCamera();
    }
}
