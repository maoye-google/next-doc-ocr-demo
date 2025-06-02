// frontend/src/components/FileUploader.jsx
import React, { useRef } from 'react';
import './FileUploader.css';

function FileUploader({ onFileSelect, onUpload, loading, selectedFile }) {
  const fileInputRef = useRef(null);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current.click(); // Trigger hidden file input
  };

  return (
    <div className="file-uploader">
      <input 
        type="file" 
        accept="image/*,application/pdf" 
        onChange={handleFileChange} 
        ref={fileInputRef}
        style={{ display: 'none' }} // Hide the default input
        id="file-input"
      />
      <button onClick={handleButtonClick} disabled={loading} className="select-button">
        {selectedFile ? `Selected: ${selectedFile.name}` : 'Select File (Image or PDF)'}
      </button>
      
      {selectedFile && (
        <div className="upload-section">
          <button onClick={onUpload} disabled={loading || !selectedFile} className="upload-button">
            {loading ? 'Uploading...' : 'Upload and Process'}
          </button>
        </div>
      )}
      {selectedFile && <p className="file-info">File: {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)</p>}
    </div>
  );
}

export default FileUploader;
