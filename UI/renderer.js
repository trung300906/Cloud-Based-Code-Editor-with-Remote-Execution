// [ADDED]: Khai báo biến lưu đường dẫn file hiện tại và lấy cái khung gõ code
let currentFilePath = null;
let editor; // Biến lưu trữ bản thể của Editor

// [ADDED]: Xử lý khi bấm File -> New (Xóa trắng Editor)
window.electronAPI.onNewFile(() => {
  if (editor) {
    // 1. Xóa sạch code trên màn hình
    editor.setValue('//Enter your code here...');
    // 2. Reset lại đường dẫn file về null
    currentFilePath = null;
    // 3. Cập nhật lại tiêu đề cửa sổ
    document.title = "New File - Diddy Skibidi";
  }
});

// [ADDED]: Cập nhật giao diện sau khi Save / Save As thành công
window.electronAPI.onFileSaved((path) => {
  currentFilePath = path;
  document.title = currentFilePath;
});

// 1. Cấu hình đường dẫn kéo file lõi Monaco
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});

// 2. Thực hiện nghi thức triệu hồi Monaco
require(['vs/editor/editor.main'], function() {
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '//Enter your code here...',
    language: 'cpp', 
    theme: 'vs-dark', // Giao diện dark mode cực ngầu
    automaticLayout: true // Tự động co giãn theo cửa sổ
  });

  // [ADDED]: Lắng nghe lệnh Save từ Menu (Ctrl+S)
  window.electronAPI.onSaveRequest((isSaveAs) => {
    const content = editor.getValue(); // Lấy code đang gõ
    if (isSaveAs || !currentFilePath) {
      // Nếu là Save As hoặc file mới chưa có tên -> Mở hộp thoại
      window.electronAPI.sendSaveFile({ filePath: null, content });
    } else {
      // Ghi đè thẳng tay
      window.electronAPI.sendSaveFile({ filePath: currentFilePath, content });
    }
  });
});

// --- XỬ LÝ ĐỔ NỘI DUNG CODE VÀO EDITOR ---
window.electronAPI.onOpenFile((data) => {
  if (editor) {
    editor.setValue(data.content); // Đổ text vào
    currentFilePath = data.filePath; // Ghi nhớ đường dẫn để lúc ấn Save nó lưu đúng chỗ
    document.title = currentFilePath; // Đổi tên cửa sổ app
  }
});

// --- 7. XỬ LÝ ĐỆ QUY VẼ CÂY THƯ MỤC LÊN SIDEBAR ---
window.electronAPI.onFolderOpened((data) => {
  const fileList = document.getElementById('file-list');
  fileList.innerHTML = ''; // Xóa sạch khung cũ

  // HÀM ĐỆ QUY VẼ GIAO DIỆN
  function createTreeHTML(items, parentElement) {
    items.forEach(item => {
      const li = document.createElement('li');
      li.style.cursor = 'pointer';
      li.style.padding = '3px 0';
      li.style.listStyleType = 'none';

      if (item.isDirectory) {
        // NẾU LÀ FOLDER: Tạo 1 thẻ span để chứa tên, và 1 thẻ ul (ẩn) để chứa con
        li.innerHTML = `<span>📁 <strong>${item.name}</strong></span>`;
        
        const childrenUl = document.createElement('ul');
        childrenUl.style.paddingLeft = '15px'; // Thụt lề cho phân biệt cha/con
        childrenUl.style.display = 'none';     // Đóng thư mục mặc định
        
        // Gọi đệ quy để vẽ tiếp tụi con cái bên trong (SỬA LẠI CHỮ children RỒI NÈ =))) )
        if (item.children) {
          createTreeHTML(item.children, childrenUl);
        }

        // Bấm vào tên folder thì đóng/mở
        const spanText = li.querySelector('span');
        spanText.onclick = (e) => {
          e.stopPropagation(); // Phanh gấp! Không cho click lan sang folder khác
          const isClosed = childrenUl.style.display === 'none';
          childrenUl.style.display = isClosed ? 'block' : 'none';
          spanText.innerHTML = (isClosed ? '📂 <strong>' : '📁 <strong>') + item.name + '</strong>';
        };

        li.appendChild(childrenUl);
      } else {
        // NẾU LÀ FILE: Click là mở code
        li.textContent = '📄 ' + item.name;
        li.onclick = (e) => {
          e.stopPropagation();
          if (item.name.match(/\.(cpp|py|txt|js|html|css|json|md)$/i)) {
            window.electronAPI.requestReadFile(item.path);
          } else {
            alert("App này chỉ đọc file text/code thôi bro ơi!");
          }
        };
      }
      
      parentElement.appendChild(li);
    });
  }

  // Khởi động nghi thức đệ quy
  createTreeHTML(data.items, fileList);
});

// --- XỬ LÝ ĐỔI NGÔN NGỮ (C++ / PYTHON) ---
let currentLangFlag = 'cpp'; // Cờ hiệu mặc định
const langSelect = document.getElementById('lang-select');

if (langSelect) {
  langSelect.addEventListener('change', (e) => {
    currentLangFlag = e.target.value;
    if (editor) {
      const monacoLang = currentLangFlag === 'python' ? 'python' : 'cpp';
      monaco.editor.setModelLanguage(editor.getModel(), monacoLang);
    }
  });
}

// --- XỬ LÝ NÚT THEME TOGGLE ---
const themeBtn = document.getElementById('theme-toggle-btn');
let isDarkMode = true; // Mặc định mở app lên là Dark mode

if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    isDarkMode = !isDarkMode; // Đảo ngược trạng thái
    
    // Đổi màu nền (thêm/xóa class 'light-mode' ở thẻ <body>)
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
      themeBtn.textContent = '🌙 Dark Mode: ON';
      if (editor) monaco.editor.setTheme('vs-dark'); // Monaco Dark
    } else {
      document.body.classList.add('light-mode');
      themeBtn.textContent = '☀️ Light Mode: ON';
      if (editor) monaco.editor.setTheme('vs'); // Monaco Light
    }
  });
}