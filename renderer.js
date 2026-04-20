// [ADDED]: Khai báo biến lưu đường dẫn file hiện tại và lấy cái khung gõ code
let currentFilePath = null;
const textArea = document.getElementById('code-input');

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

// Biến lưu trữ bản thể của Editor
let editor;

// 1. Cấu hình đường dẫn kéo file lõi Monaco
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});

// 2. Thực hiện nghi thức triệu hồi Monaco
require(['vs/editor/editor.main'], function() {
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '//Enter your code here...',
    language: 'javascript', 
    theme: 'vs-dark',       
    automaticLayout: true   
  });
});

// 3. Xử lý nút Submit làm cảnh (sau này Backend thêm logic vào đây)
document.getElementById('submit-btn').addEventListener('click', () => {
  if (editor) {
    alert("Đã Submit thành công! (Code hiện tại đã được in ra console)");
    console.log("Nội dung gửi đi Backend:\n", editor.getValue());
  }
});

// 3.5. XỬ LÝ CHUYỂN ĐỔI THEME DARK/LIGHT 
let isDarkMode = true; // Biến trạng thái, mặc định là đang bật
const themeBtn = document.getElementById('theme-toggle-btn');

themeBtn.addEventListener('click', () => {
  isDarkMode = !isDarkMode; // Lật ngược trạng thái (True thành False, False thành True)
  
  if (isDarkMode) {
    // 1. Tháo lớp áo light-mode ra khỏi thẻ <body>
    document.body.classList.remove('light-mode');
    // 2. Đổi chữ trên nút
    themeBtn.textContent = '🌙 Dark Mode: ON';
    // 3. Ra lệnh cho Monaco đổi sang Theme đen
    monaco.editor.setTheme('vs-dark'); 
  } else {
    // 1. Mặc lớp áo light-mode vào thẻ <body>
    document.body.classList.add('light-mode');
    // 2. Đổi chữ trên nút
    themeBtn.textContent = '☀️ Dark Mode: OFF';
    // 3. Ra lệnh cho Monaco đổi sang Theme trắng
    monaco.editor.setTheme('vs'); 
  }
});

// 4. Xử lý mở File -> Quăng text vào Editor
window.electronAPI.onOpenFile((data) => {
  /* if (editor) {
    editor.setValue(data.content); 
  } */
 if (editor) {
    editor.setValue(data.content); 
    
    // Tự động nhận diện ngôn ngữ dựa vào đuôi file
    if (data.filePath) {
      if (data.filePath.endsWith('.py')) {
        currentLangFlag = 'python';
        document.getElementById('lang-select').value = 'python'; // Đổi luôn cái dropdown trên UI
        monaco.editor.setModelLanguage(editor.getModel(), 'python');
      } else if (data.filePath.endsWith('.cpp')) {
         currentLangFlag = 'cpp';
         document.getElementById('lang-select').value = 'cpp';
         monaco.editor.setModelLanguage(editor.getModel(), 'cpp');
      }
    }
  }
});

// 5. Xử lý Lưu File (Ctrl+S) -> Moi text từ Editor ra
window.electronAPI.onSaveRequest(() => {
  if (editor) {
    window.electronAPI.sendSaveFile({
      filePath: null, 
      content: editor.getValue() 
    });
  }
});

// 6. Xử lý Lưu File dưới tên khác (Ctrl+Shift+S)
window.electronAPI.onSaveAsRequest(() => {
  if (editor) {
    window.electronAPI.sendSaveFile({
      filePath: null, 
      content: editor.getValue()
    });
  }
});

// 7. Xử lý vẽ Cây thư mục (Cơ bản)
window.electronAPI.onFolderOpened((data) => {
  const fileList = document.getElementById('file-list');
  fileList.innerHTML = ''; 

  data.items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = (item.isDirectory ? '📁 ' : '📄 ') + item.name;
    li.style.cursor = 'pointer';
    li.style.padding = '5px 0'; 
    li.style.listStyleType = 'none'; 

    if (!item.isDirectory) {
      // Nếu là FILE -> Gắn sự kiện click đúp (hoặc click đơn) để đọc
      li.onclick = () => {
        // Chỉ chấp nhận đọc file text, bỏ qua file .exe, .png... tránh lỗi giun dế
        if (item.name.endsWith('.cpp') || item.name.endsWith('.py') || item.name.endsWith('.txt')) {
          window.electronAPI.requestReadFile(item.path);
        } else {
          alert("Chỉ hỗ trợ mở file .cpp, .py hoặc .txt thôi bro!");
        }
      };
    } else {
      // Nếu là FOLDER
      li.onclick = () => { li.style.fontWeight = li.style.fontWeight === 'bold' ? 'normal' : 'bold'; }
    }
    
    fileList.appendChild(li);
  });
});

// --- XỬ LÝ ĐỔI NGÔN NGỮ (C++ / PYTHON) ---
let currentLangFlag = 'cpp'; // Cờ hiệu mặc định
const langSelect = document.getElementById('lang-select');

langSelect.addEventListener('change', (e) => {
  currentLangFlag = e.target.value; // Cập nhật cờ hiệu
  
  if (editor) {
    // Ép Monaco đổi bộ Highlight Syntax (nhận diện cú pháp)
    monaco.editor.setModelLanguage(editor.getModel(), currentLangFlag);
  }
  console.log("Đã chuyển mode sang:", currentLangFlag);
});
//Khi bấm submit, chỉ cần gom cái currentLangFlag với editor.getValue() ném đi là server biết 
//đang dùng ngôn ngữ nào

