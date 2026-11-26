export class SmartRouter {
  private static COMPLEX_PATTERNS = [
    // Lập trình, cú pháp & Kỹ thuật
    /```[\s\S]*?```/,
    /\b(function|class|interface|import|export|const|let|var|return|def|fn|async|await|struct|enum|impl|pub)\b/,
    /\b(algorithm|refactor|optimize|architecture|database|mutex|deadlock|concurrency|race condition|memory leak|pointer|polymorphism|unit test|benchmark|stacktrace|syntaxerror|typeerror|uncaught|exception|panic)\b/i,
    /\b(lập trình|thuật toán|tối ưu|kiến trúc|cơ sở dữ liệu|bộ nhớ|sửa lỗi|bắt lỗi|ngoại lệ|hàm|lớp|đối tượng|phân tích lỗi|sửa bug|refactor|viết test|kiểm thử)\b/i,
    // Tư duy logic & Suy luận
    /\b(reasoning|step[- ]by[- ]step|prove|proof|deduce|derivation|analyze deeply|chain of thought|root cause|tradeoff)\b/i,
    /\b(suy luận|chứng minh|từng bước|phân tích logic|phân tích sâu|tại sao|nguyên nhân gốc|giải thích chi tiết|đánh giá rủi ro|so sánh|ưu nhược điểm)\b/i
  ];

  public static isSmartModel(modelName: string): boolean {
    const m = modelName.toLowerCase();
    return (
      m.includes('argon') ||
      m.includes('pro') ||
      m.includes('sonnet') ||
      m.includes('opus') ||
      m.includes('r1') ||
      m.includes('reasoning') ||
      m.includes('thinking') ||
      m.includes('o1') ||
      m.includes('o3')
    );
  }

  public static isFastModel(modelName: string): boolean {
    const m = modelName.toLowerCase();
    return (
      m.includes('flash') ||
      m.includes('mini') ||
      m.includes('haiku') ||
      m.includes('nano') ||
      m.includes('turbo')
    );
  }

  public static calculateComplexity(messages: any[], tools?: any[]): { isComplex: boolean; score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    // 1. Trích xuất nội dung tin nhắn cuối cùng của User (và tin nhắn cuối cùng trong mảng để bắt kết quả tool lỗi nếu có)
    let lastUserText = '';
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg) continue;
        const role = msg.role || '';
        if (role === 'user') {
          if (typeof msg.content === 'string') {
            lastUserText = msg.content;
          } else if (Array.isArray(msg.content)) {
            lastUserText = msg.content.map((p: any) => p?.text || '').join('\n');
          } else if (Array.isArray(msg.parts)) {
            lastUserText = msg.parts.map((p: any) => p?.text || '').join('\n');
          }
          break;
        }
      }
    }

    // Nếu tin nhắn có wrapper "[Discussion: ...]" của phòng chat, chỉ lấy phần sau "New messages in this thread" để không chấm điểm nhầm System Prompt
    let targetText = lastUserText;
    const threadMarker = 'New messages in this thread since your last turn';
    const markerIdx = targetText.indexOf(threadMarker);
    if (markerIdx >= 0) {
      targetText = targetText.slice(markerIdx);
    }

    if (targetText) {
      let patternMatches = 0;
      for (const pattern of this.COMPLEX_PATTERNS) {
        if (pattern.test(targetText)) {
          patternMatches++;
        }
      }

      if (patternMatches >= 2) {
        score += 45;
        reasons.push('Chứa mẫu logic & code nâng cao');
      } else if (patternMatches === 1) {
        score += 25;
        reasons.push('Chứa từ khóa kỹ thuật');
      }

      if (targetText.length > 2000) {
        score += 25;
        reasons.push(`Yêu cầu dài (${targetText.length} ký tự)`);
      } else if (targetText.length > 700) {
        score += 15;
      }
    }

    // 2. Chỉ cộng điểm Tools khi bản thân yêu cầu đã có dấu hiệu kỹ thuật (tránh việc mọi câu chat đơn giản trong IDE đều bị đẩy vào model nặng)
    if (tools && tools.length > 0 && score >= 25) {
      score += 10;
      reasons.push(`${tools.length} Tools tích hợp`);
    }

    // Ngưỡng phân loại thông minh: score >= 35 là tác vụ phức tạp cần model reasoning/code cao cấp
    const isComplex = score >= 35;
    return {
      isComplex,
      score,
      reason: reasons.length > 0 ? reasons.join(' + ') : (isComplex ? 'Độ phức tạp cao' : 'Tác vụ nhanh / điều phối')
    };
  }

  public static getSmartTierScore(modelName: string): number {
    const m = modelName.toLowerCase();
    // Ưu tiên số 1 cho Claude Sonnet 5.5 High / 3.7 Sonnet vì tốc độ phản hồi siêu nhanh (~2.2s) và chất lượng code đỉnh cao
    if (m.includes('sonnet-5-5-high') || m.includes('3-7-sonnet')) return 105;
    if (m.includes('argon-high') || m.includes('thinking')) return 95;
    if (m.includes('argon') || m.includes('opus') || m.includes('r1')) return 90;
    if (m.includes('pro') || m.includes('sonnet') || m.includes('o1') || m.includes('o3')) return 80;
    return 50;
  }

  public static getFastTierScore(modelName: string): number {
    const m = modelName.toLowerCase();
    if (m.includes('3.8-flash-high') || m.includes('3.8-flash')) return 100;
    if (m.includes('2.5-flash')) return 95;
    if (m.includes('flash') || m.includes('haiku') || m.includes('mini')) return 85;
    return 50;
  }

  public static prioritizeModels(models: string[], isComplex: boolean): string[] {
    if (!models || models.length === 0) return [];

    const smartModels: string[] = [];
    const fastModels: string[] = [];
    const neutralModels: string[] = [];

    for (const m of models) {
      if (this.isFastModel(m)) {
        fastModels.push(m);
      } else if (this.isSmartModel(m)) {
        smartModels.push(m);
      } else {
        neutralModels.push(m);
      }
    }

    // Sắp xếp smartModels (Claude Sonnet 5.5 High -> Argon High) và fastModels (3.8 Flash High -> 2.5 Flash)
    smartModels.sort((a, b) => this.getSmartTierScore(b) - this.getSmartTierScore(a));
    fastModels.sort((a, b) => this.getFastTierScore(b) - this.getFastTierScore(a));

    if (isComplex) {
      // Ưu tiên mô hình thông minh & tốc độ code nhanh nhất trước
      return [...smartModels, ...neutralModels, ...fastModels];
    } else {
      // Ưu tiên mô hình Flash tốc độ cao (~1-2s) trước
      return [...fastModels, ...neutralModels, ...smartModels];
    }
  }
}
