/**
 * Toast Notification System (Similar to VSCode)
 */

export const ToastType = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

const iconMap = {
  [ToastType.INFO]: 'ℹ️',
  [ToastType.SUCCESS]: '✅',
  [ToastType.WARNING]: '⚠️',
  [ToastType.ERROR]: '❌'
};

/**
 * Show a toast notification
 * @param {string} message - The main text of the notification
 * @param {string} [type=ToastType.INFO] - The type of toast (info, success, warning, error)
 * @param {string} [title=""] - Optional bold title above the message
 * @param {number} [duration=5000] - Duration in ms before it auto-closes (0 to keep open)
 */
export function showToast(message, type = ToastType.INFO, title = "", duration = 5000) {
  const container = document.getElementById('toast-container');
  if (!container) {
    console.error("Toast container not found in DOM");
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  // Icon
  const icon = document.createElement('div');
  icon.className = 'toast-icon';
  icon.textContent = iconMap[type] || iconMap[ToastType.INFO];

  // Content
  const content = document.createElement('div');
  content.className = 'toast-content';
  
  if (title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;
    content.appendChild(titleEl);
  }
  
  const msgEl = document.createElement('div');
  msgEl.className = 'toast-message';
  msgEl.textContent = message;
  content.appendChild(msgEl);

  // Close button
  const closeBtn = document.createElement('div');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = '&#10005;'; // HTML entity for 'X'
  
  toast.appendChild(icon);
  toast.appendChild(content);
  toast.appendChild(closeBtn);

  // Auto-close timer
  let timerId = null;
  
  const closeToast = () => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    if (timerId) clearTimeout(timerId);
    
    // Remove from DOM after animation completes
    setTimeout(() => {
      if (toast.parentNode === container) {
        container.removeChild(toast);
      }
    }, 300);
  };

  closeBtn.addEventListener('click', closeToast);

  if (duration > 0) {
    timerId = setTimeout(closeToast, duration);
  }

  container.appendChild(toast);

  // Trigger reflow for animation
  void toast.offsetWidth;
  toast.classList.add('toast-show');
}

// Make it available globally so it can be called from anywhere in renderer (like menubar.js)
window.showToast = showToast;
window.ToastType = ToastType;
