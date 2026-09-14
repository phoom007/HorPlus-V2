import React from 'react';

interface ThaiQrLogoProps {
  className?: string;
}

/**
 * High-fidelity, local inline vector representation of the Thai QR Payment / PromptPay brandmark.
 * Zero external HTTP requests to Wikimedia Commons or third-party CDNs.
 */
export const ThaiQrLogo: React.FC<ThaiQrLogoProps> = ({
  className = 'h-8 sm:h-9 w-auto max-w-[150px] object-contain mx-auto drop-shadow-2xs'
}) => (
  <img
    src="/images/Thai_QR_Logo.svg"
    alt="Thai QR Payment"
    className={className}
    loading="eager"
    decoding="sync"
  />
);

export default ThaiQrLogo;
