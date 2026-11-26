# SPEC — TASK-20261126-EXPAND-AI-PROVIDERS-CATALOG
**Task ID:** TASK-20261126-EXPAND-AI-PROVIDERS-CATALOG  
**Mục tiêu:** Mở rộng danh mục Dịch Vụ AI Mở Rộng & Dự Phòng Tự Động từ 6 lên 14 nhà cung cấp, phủ khắp các nhóm: Tự chạy Cục bộ (Local/Offline), Siêu Tốc Độ (Ultra-Fast Inference), Miễn Phí (Community/Free Tiers), và Hạ Tầng Đám Mây Lớn (Open-Source Ecosystem).  
**Trạng thái phê duyệt:** Chờ @phan-bac đánh giá và cấp `AUTO_PASS_TOKEN`.

---

## 1. Danh sách Nhà Cung Cấp Nghiên Cứu & Bổ Sung
Hệ thống hiện tại chỉ có 6 nhà cung cấp. Bổ sung thêm 8 nhà cung cấp chất lượng cao sau:

1. **LM Studio / Local Server (Offline/Private)**:
   - Base URL: `http://localhost:1234/v1`
   - Miễn phí 100%, bảo mật dữ liệu tuyệt đối ngay trên Mac/PC, không cần Internet.
   - Models: `local-model`, `qwen2.5-coder-7b`, `gemma-4-12b`
2. **Ollama Local (Tự lưu trữ cục bộ)**:
   - Base URL: `http://localhost:11434/v1`
   - Chuẩn OpenAI API cục bộ phổ biến nhất.
   - Models: `llama3.3:latest`, `qwen2.5-coder:32b`, `deepseek-r1:latest`
3. **Cerebras Cloud (Inference Siêu Tốc Độ 1800+ tok/s)**:
   - Base URL: `https://api.cerebras.ai/v1`
   - Tốc độ sinh token nhanh nhất thế giới nhờ chip Wafer-Scale, có gói Free Tier.
   - Models: `llama-3.3-70b`, `llama3.1-8b`, `qwen-2.5-32b`
4. **SiliconFlow / SiliconCloud (Hệ Sinh Thái DeepSeek & Qwen)**:
   - Base URL: `https://api.siliconflow.cn/v1`
   - Cung cấp DeepSeek V3/R1 và Qwen 2.5 Coder với chi phí rẻ và nhiều model Free.
   - Models: `deepseek-ai/DeepSeek-V3`, `deepseek-ai/DeepSeek-R1`, `Qwen/Qwen2.5-Coder-32B-Instruct`
5. **Together AI (Open-Source Leading Cloud)**:
   - Base URL: `https://api.together.xyz/v1`
   - Hạ tầng inference nguồn mở ổn định và đa dạng nhất.
   - Models: `meta-llama/Llama-3.3-70B-Instruct-Turbo`, `deepseek-ai/DeepSeek-R1`
6. **Mistral AI Official (Châu Âu / Codestral)**:
   - Base URL: `https://api.mistral.ai/v1`
   - Hỗ trợ model chuyên lập trình Codestral và Mistral Large (có Free Tier).
   - Models: `codestral-latest`, `mistral-large-latest`, `mistral-small-latest`
7. **Google AI Studio (Gemini Direct OpenAI Endpoint)**:
   - Base URL: `https://generativelanguage.googleapis.com/v1beta/openai`
   - Endpoint chuẩn OpenAI chính thức của Google, tận dụng Gemini API Key miễn phí (15 RPM).
   - Models: `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`
8. **GitHub Models / Azure AI (Free Tier qua GitHub Token)**:
   - Base URL: `https://models.inference.ai.azure.com`
   - Cho phép dùng miễn phí GPT-4o, Llama 3.3 bằng GitHub Personal Access Token.
   - Models: `gpt-4o`, `gpt-4o-mini`, `Meta-Llama-3.3-70B-Instruct`

---

## 2. Kế hoạch kỹ thuật
1. Cập nhật `DEFAULT_PROVIDERS` trong `src/services/externalProviders.ts` lên 14 nhà cung cấp, chuẩn hóa `priority`, `models`, `isFree`.
2. Kiểm tra tính tự động gộp (`existingIds`) trong `ExternalProviderManager.getProviders()` để cấu hình mới tự nạp vào DB SQLite mà không làm mất API Key người dùng đã nhập.
3. Build, restart server, kiểm tra `/api/providers` trả về đầy đủ 14 nhà cung cấp.
