/**
 * @license Apache-2.0
 * PromptPay Card Image Generator & Download Utility
 */

export interface DownloadPromptPayCardOptions {
  qrDataUrl: string;
  promptPayId: string;
  accountName: string;
  amount: number;
  planName: string;
  durationLabel: string;
}

/**
 * Loads an image from a data URL asynchronously
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * Downloads a beautifully formatted PromptPay payment card as a PNG image
 */
export async function downloadPromptPayCardImage(options: DownloadPromptPayCardOptions): Promise<void> {
  const {
    qrDataUrl,
    promptPayId,
    accountName,
    amount,
    planName,
    durationLabel
  } = options;

  // Setup high-res canvas (width: 700px, height: 960px)
  const width = 700;
  const height = 960;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not supported');
  }

  // Draw background (subtle gradient)
  const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
  bgGradient.addColorStop(0, '#f8fafc');
  bgGradient.addColorStop(1, '#f1f5f9');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Draw Header Bar (PromptPay Blue / Indigo)
  const headerGradient = ctx.createLinearGradient(0, 0, width, 0);
  headerGradient.addColorStop(0, '#1e3a8a');
  headerGradient.addColorStop(1, '#2563eb');
  ctx.fillStyle = headerGradient;
  
  // Rounded top card header
  const cardMargin = 30;
  const cardWidth = width - cardMargin * 2;
  const cardHeight = height - cardMargin * 2;
  const cardRadius = 24;

  // Draw Card Container with Drop Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#ffffff';

  ctx.beginPath();
  ctx.roundRect(cardMargin, cardMargin, cardWidth, cardHeight, cardRadius);
  ctx.fill();
  ctx.restore();

  // Header Banner inside Card
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cardMargin, cardMargin, cardWidth, 140, [cardRadius, cardRadius, 0, 0]);
  ctx.clip();
  ctx.fillStyle = headerGradient;
  ctx.fillRect(cardMargin, cardMargin, cardWidth, 140);
  ctx.restore();

  // Header Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('พร้อมเพย์ (PromptPay)', width / 2, cardMargin + 55);

  ctx.font = '500 18px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText('สแกน QR เพื่อชำระเงินผ่าน Mobile Banking ทุกธนาคาร', width / 2, cardMargin + 95);

  // Plan info badge
  const badgeY = cardMargin + 180;
  ctx.fillStyle = '#eff6ff';
  const badgeWidth = 340;
  const badgeHeight = 44;
  ctx.beginPath();
  ctx.roundRect((width - badgeWidth) / 2, badgeY, badgeWidth, badgeHeight, 10);
  ctx.fill();
  ctx.strokeStyle = '#bfdbfe';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#1d4ed8';
  ctx.font = '600 18px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  ctx.fillText(`${planName} (${durationLabel})`, width / 2, badgeY + 28);

  // Amount display
  const amountY = badgeY + 105;
  ctx.fillStyle = '#64748b';
  ctx.font = '500 18px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  ctx.fillText('จำนวนเงินที่ต้องชำระ', width / 2, amountY);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 44px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  const formattedAmount = `฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  ctx.fillText(formattedAmount, width / 2, amountY + 50);

  // QR Code Box
  const qrSize = 300;
  const qrX = (width - qrSize) / 2;
  const qrY = amountY + 80;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32, 16);
  ctx.fill();
  ctx.stroke();

  // Load and draw QR code
  try {
    const qrImage = await loadImage(qrDataUrl);
    ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
  } catch (err) {
    console.error('Failed to load QR code image for card:', err);
    throw err;
  }

  // Account Details Box
  const detailsY = qrY + qrSize + 45;
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(cardMargin + 30, detailsY, cardWidth - 60, 105, 12);
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Account text inside box
  ctx.textAlign = 'left';
  const textLeft = cardMargin + 55;

  ctx.fillStyle = '#64748b';
  ctx.font = '500 16px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  ctx.fillText('ชื่อบัญชี:', textLeft, detailsY + 38);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 18px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  ctx.fillText(accountName, textLeft + 80, detailsY + 38);

  ctx.fillStyle = '#64748b';
  ctx.font = '500 16px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  ctx.fillText('พร้อมเพย์:', textLeft, detailsY + 75);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 18px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  ctx.fillText(promptPayId, textLeft + 80, detailsY + 75);

  // Footer note
  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '400 15px "Noto Sans Thai", "Kanit", sans-serif, system-ui';
  ctx.fillText('ระบบตรวจสลิปอัตโนมัติ 24 ชม. • ขอบคุณที่เลือกใช้ HORPLUS', width / 2, cardHeight - 15);

  // Convert canvas to image and trigger download
  const dataUrl = canvas.toDataURL('image/png');
  const cleanId = promptPayId.replace(/[^0-9]/g, '');
  const link = document.createElement('a');
  link.download = `HorPlus-PromptPay-${cleanId}-${amount.toFixed(0)}THB.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
