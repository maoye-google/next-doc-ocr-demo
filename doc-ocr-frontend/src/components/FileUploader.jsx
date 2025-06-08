import React, { useRef } from 'react';
import './FileUploader.css';

function FileUploader({ onFileSelect, selectedFile }) {
  const fileInputRef = useRef(null);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current.click();
  };

  return (
    <div style={{
      margin: '20px 0',
      padding: '20px',
      backgroundColor: '#f8f9fa',
      borderRadius: '8px',
      border: '1px solid #dee2e6'
    }}>
      <h3 style={{ marginBottom: '15px', color: '#495057' }}>File Uploader</h3>
      
      <input 
        type="file" 
        accept="image/*,application/pdf" 
        onChange={handleFileChange} 
        ref={fileInputRef}
        style={{ display: 'none' }}
        id="file-input"
      />
      
      <button 
        onClick={handleButtonClick} 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 24px',
          fontSize: '16px',
          fontWeight: '500',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          backgroundColor: '#007bff',
          color: 'white',
          width: '100%',
          justifyContent: 'center',
          marginBottom: selectedFile ? '15px' : '0'
        }}
      >
        <span style={{ fontSize: '18px' }}>📁</span>
        {selectedFile ? 'Change File' : 'Select File (Image or PDF)'}
      </button>

      {selectedFile && (
        <div style={{
          padding: '12px',
          backgroundColor: '#e3f2fd',
          borderRadius: '4px',
          border: '1px solid #bbdefb',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span style={{ fontSize: '16px' }}>📄</span>
          <div>
            <p style={{ margin: '0', fontWeight: '500', color: '#1976d2' }}>
              Selected: {selectedFile.name}
            </p>
            <p style={{ margin: '0', fontSize: '12px', color: '#616161' }}>
              Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileUploader;