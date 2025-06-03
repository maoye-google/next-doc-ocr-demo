// frontend/src/components/DocumentViewer.jsx
import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import './DocumentViewer.css';

// Helper to draw bounding boxes
const drawBoundingBox = (ctx, box, text, score, imageScale) => {
  ctx.beginPath();
  // Box format: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
  // Ensure coordinates are scaled
  ctx.moveTo(box[0][0] * imageScale, box[0][1] * imageScale);
  ctx.lineTo(box[1][0] * imageScale, box[1][1] * imageScale);
  ctx.lineTo(box[2][0] * imageScale, box[2][1] * imageScale);
  ctx.lineTo(box[3][0] * imageScale, box[3][1] * imageScale);
  ctx.closePath();
  
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)'; // Red color for box
  ctx.lineWidth = 2;
  ctx.stroke();

  // Optional: Display text and score (can be improved for better visibility)
  ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
  ctx.font = `${12 * imageScale}px Arial`;
  // Position text near the top-left corner of the bounding box
  ctx.fillText(`${text} (${score.toFixed(2)})`, (box[0][0] * imageScale) + 5, (box[0][1] * imageScale) - 5);
};

function DocumentViewer({ fileUrl, fileType, ocrResults }) {
  const imageCanvasRef = useRef(null); // For single image display
  const pdfPagesRef = useRef([]); // For PDF pages, array of canvas refs
  const [pdfPagesData, setPdfPagesData] = useState([]); // Stores { url, width, height } for each PDF page
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 });

  // Debug logging
  console.log('DocumentViewer props:', { fileUrl, fileType, ocrResults: ocrResults?.length });

  // Effect for rendering single image and its OCR results
  useEffect(() => {
    if (fileType === 'image' && fileUrl && imageCanvasRef.current) {
      const canvas = imageCanvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        // Determine display size (e.g., fit within a max width)
        const maxWidth = canvas.parentElement.clientWidth || 600;
        const scale = Math.min(1, maxWidth / img.naturalWidth);
        canvas.width = img.naturalWidth * scale;
        canvas.height = img.naturalHeight * scale;
        setImageDimensions({ width: canvas.width, height: canvas.height, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Draw OCR boxes if results are available for page 1 (image is page 1)
        if (ocrResults && ocrResults.length > 0 && ocrResults[0].page_number === 1) {
          const imageScale = canvas.width / img.naturalWidth; // Scale factor from original image to displayed canvas
          ocrResults[0].detections.forEach(detection => {
            drawBoundingBox(ctx, detection.box, detection.text, detection.score, imageScale);
          });
        }
      };
      img.onerror = () => {
        console.error("Failed to load image for display.");
      };
      img.src = fileUrl;
    }
  }, [fileUrl, fileType, ocrResults, imageCanvasRef]);

  // Effect for rendering PDF pages and their OCR results
  useEffect(() => {
    if (fileType === 'pdf' && fileUrl) {
      console.log('Loading PDF:', fileUrl);
      const loadPdf = async () => {
        try {
          console.log('Creating PDF loading task...');
          const loadingTask = pdfjsLib.getDocument(fileUrl);
          const pdf = await loadingTask.promise;
          console.log('PDF loaded successfully, pages:', pdf.numPages);
          const numPages = pdf.numPages;
          const pagesData = [];
          pdfPagesRef.current = []; // Reset refs

          for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 }); // Render at 1.5x scale for clarity
            
            // Prepare canvas for this page
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');

            const renderContext = {
              canvasContext: context,
              viewport: viewport,
            };
            await page.render(renderContext).promise;
            pagesData.push({ 
              id: `pdf-page-${i}`,
              dataUrl: canvas.toDataURL(), 
              width: viewport.width, 
              height: viewport.height,
              naturalWidth: viewport.width / 1.5, // Store original dimensions before scaling
              naturalHeight: viewport.height / 1.5
            });
          }
          console.log('PDF pages processed:', pagesData.length);
          setPdfPagesData(pagesData);
        } catch (error) {
          console.error('Error loading PDF for display:', error);
          console.error('PDF URL:', fileUrl);
          console.error('Error details:', error.message);
        }
      };
      loadPdf();
    }
  }, [fileUrl, fileType]);

  // Effect to draw OCR on PDF pages once they are rendered and OCR results are available
  useEffect(() => {
    if (fileType === 'pdf' && pdfPagesData.length > 0 && ocrResults && ocrResults.length > 0) {
      pdfPagesData.forEach((pageData, index) => {
        const canvasRef = pdfPagesRef.current[index];
        if (canvasRef) {
          const ctx = canvasRef.getContext('2d');
          const img = new Image();
          img.onload = () => {
            // Redraw the page image first
            ctx.drawImage(img, 0, 0, canvasRef.width, canvasRef.height);
            
            // Find OCR results for this page
            const pageResult = ocrResults.find(r => r.page_number === (index + 1));
            if (pageResult) {
              // The OCR was performed on 120 DPI images, but frontend renders at 1.5x scale
              // We need to account for both the backend DPI scaling and frontend display scaling
              const backendDPI = 120;
              const frontendScale = 1.5;
              
              // Check if this page contains mostly Japanese text
              const hasJapanese = pageResult.detections.some(detection => 
                /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(detection.text)
              );
              
              // Apply different scaling for Japanese text which may have different coordinate handling
              let imageScale;
              if (hasJapanese) {
                // For Japanese text, the coordinates seem to be larger than expected
                // Apply a reduced scaling factor to compensate
                const baseScale = (frontendScale * 75) / backendDPI;
                imageScale = baseScale * 0.9; // Reduce by 40% to compensate for oversized coordinates
              } else {
                // For English text, use the DPI-based scaling
                imageScale = (frontendScale * 72) / backendDPI;
              }
              
              pageResult.detections.forEach(detection => {
                const isJapaneseText = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(detection.text);
                if (isJapaneseText) {
                  // Adjust the box coordinates for Japanese text by adding a fixed offset to the height
                  // const adjustedBox = detection.box.map(point => [point[0]*1.01, point[1]*1.005+65]);
                  const adjustedBox = detection.box.map(point => [point[0]*1.01, point[1]*0.98+85]);
                  drawBoundingBox(ctx, adjustedBox, detection.text, detection.score, imageScale);
                } else {
                  drawBoundingBox(ctx, detection.box, detection.text, detection.score, imageScale);
                }
              });
            }
          };
          img.src = pageData.dataUrl;
        }
      });
    }
  }, [pdfPagesData, ocrResults, fileType]);

  if (!fileUrl) return null;

  return (
    <div className="document-viewer">
      <h3>Document Preview</h3>
      {fileType === 'image' && (
        <div className="image-container">
          <canvas ref={imageCanvasRef} />
        </div>
      )}
      {fileType === 'pdf' && (
        <div className="pdf-container">
          {pdfPagesData.length === 0 ? (
            <div className="pdf-loading">Loading PDF...</div>
          ) : (
            pdfPagesData.map((page, index) => (
              <div key={page.id} className="pdf-page">
                <h4>Page {index + 1}</h4>
                <canvas 
                  ref={el => {
                    if (el) {
                      pdfPagesRef.current[index] = el;
                      // Initialize canvas with page image
                      const ctx = el.getContext('2d');
                      const img = new Image();
                      img.onload = () => {
                        ctx.drawImage(img, 0, 0, el.width, el.height);
                      };
                      img.src = page.dataUrl;
                    }
                  }}
                  width={page.width} 
                  height={page.height}
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default DocumentViewer;
