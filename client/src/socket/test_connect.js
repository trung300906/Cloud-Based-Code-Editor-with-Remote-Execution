const tcpClient = require('./tcpClient.js');

const TOTAL_JOBS = 5; // Bắn 20 job (nếu mượt bác có thể nâng lên 50, 100)
const DELAY_BETWEEN_JOBS_MS = 50; // Cách nhau 50ms để không bị Rate Limit đá văng ngay lập tức

console.log(`=================================================`);
console.log(`🚀 BẮT ĐẦU STRESS TEST: Nã ${TOTAL_JOBS} jobs vào Gateway!`);
console.log(`=================================================`);

// Đợi 1 giây cho Client kết nối Gateway ổn định rồi mới nã đạn
setTimeout(() => {
  for (let i = 1; i <= TOTAL_JOBS; i++) {
    const jobId = `stress-job-${i.toString().padStart(3, '0')}`;
    
    // Code Python: Bắt nó sleep 2 giây để nó "ngâm" Container. 
    // Ngâm càng lâu, server càng phải scale up nhiều Docker mới.
    const myPythonCode = `
import time
import sys

print("🔥 [BẮT ĐẦU] ${jobId} đang chạy trên Docker...")
# Giả lập tác vụ tính toán AI hoặc Compile nặng mất 2 giây
time.sleep(2) 
print("✅ [HOÀN THÀNH] ${jobId} xử lý xong!")
`;

    // Lên đạn và bắn có độ trễ
    setTimeout(() => {
      console.log(`[Bắn đạn] 🔫 Đang gửi: ${jobId}...`);
      tcpClient.send(tcpClient.TYPE.RUN, jobId, myPythonCode);
    }, i * DELAY_BETWEEN_JOBS_MS);
  }
}, 1000);