/**
 * scanner.js - Document Detection and Processing logic
 */

const Scanner = {
    // Finds the document contour in an image
    findDocumentContour: function(src) {
        let gray = new cv.Mat();
        let blurred = new cv.Mat();
        let edged = new cv.Mat();
        let contours = new cv.輪郭Vector();
        let hierarchy = new cv.Mat();

        // 1. Pre-processing: Grayscale and Blur to reduce noise
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

        // 2. Edge Detection
        cv.Canny(blurred, edged, 75, 200);

        // 3. Find Contours
        cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let maxContour = null;

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);
            if (area > 5000) { // Threshold to ignore small bits of noise
                let peri = cv.arcLength(contour, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(contour, approx, 0.02 * peri, true);

                // Document should have 4 points
                if (approx.rows === 4 && area > maxArea) {
                    maxArea = area;
                    maxContour = approx;
                }
            }
        }

        // Cleanup memory
        gray.delete(); blurred.delete(); edged.delete(); contours.delete(); hierarchy.delete();

        return maxContour;
    },

    // Flattens the document (Perspective Transform)
    transformPerspective: function(src, contour) {
        let width = src.cols;
        let height = src.rows;

        // Extract the 4 points from the contour
        let corners = [];
        for (let i = 0; i < 4; i++) {
            corners.push({ x: contour.data32S[i * 2], y: contour.data32S[i * 2 + 1] });
        }

        // Sort corners: [top-left, top-right, bottom-right, bottom-left]
        corners.sort((a, b) => a.y - b.y);
        let top = corners.slice(0, 2).sort((a, b) => a.x - b.x);
        let bottom = corners.slice(2, 4).sort((a, b) => a.x - b.x);
        
        let srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
            top[0].x, top[0].y, 
            top[1].x, top[1].y, 
            bottom[1].x, bottom[1].y, 
            bottom[0].x, bottom[0].y
        ]);

        // Define target dimensions (Standard A4 ratio or similar)
        let dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0, 
            width, 0, 
            width, height, 
            0, height
        ]);

        let M = cv.getPerspectiveTransform(srcCoords, dstCoords);
        let dst = new cv.Mat();
        cv.warpPerspective(src, dst, M, new cv.Size(width, height));

        // Cleanup
        M.delete(); srcCoords.delete(); dstCoords.delete();
        
        return dst;
    },

    // Final enhancement: "The Magic Filter"
    applyMagicFilter: function(src) {
        let dst = new cv.Mat();
        cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
        // Adaptive thresholding makes text pop and background white
        cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
        return dst;
    }
};
