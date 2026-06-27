async function fetchUserInfoMultipleTimes() {
    const apiUrl = 'https://api.parroto.app/api/user/info';
    
    const token = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjJmMjk1MGEyNGFlYWRkMjYzYzIxM2I2MDNhZjMxNWEzMjdiNmM3MjAiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vc2hhZG93LWRpY3RhdGlvbiIsImF1ZCI6InNoYWRvdy1kaWN0YXRpb24iLCJhdXRoX3RpbWUiOjE3ODI1MzUxMjksInVzZXJfaWQiOiJFRkd2T1BjcGNqT0E0WHo5NWFIMzJpdU1aNWQyIiwic3ViIjoiRUZHdk9QY3Bjak9BNFh6OTVhSDMyaXVNWjVkMiIsImlhdCI6MTc4MjUzNTEyOSwiZXhwIjoxNzgyNTM4NzI5LCJlbWFpbCI6ImpuenZhYWd1cmMydkBtZWx0Y29vLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJmaXJlYmFzZSI6eyJpZGVudGl0aWVzIjp7ImVtYWlsIjpbImpuenZhYWd1cmMydkBtZWx0Y29vLmNvbSJdfSwic2lnbl9pbl9wcm92aWRlciI6InBhc3N3b3JkIn19.XrBiKcvLH-K5oHmu1yf8XpVNScGRHhxfRJsnPCf8AVW_JepEbur4MG9CQimE-e61zUxdh6lQLF-8dnHJkmlUyYzCgtveJH3kNk7QTDcg5ezG1h7F6IGe1F9IWC_Oz8Cpo-FgwNUR7KZo6r0MeJt6kXCaeWg_QtuNBVfpAywcDFEHHSR3CHTDlCeygSc32hBpmAMPKhc7RVbxV-0CjhtUcG3qw-g7nAENQ6Le8-BYrdeLFR0pRsp9eX1_ki7O-kNuo80a0L4VDk2FwHPuZed6T-U0fQSNJD1PU6DBUYhqk273wm-leTNatMSVYCWTjsU0SXuNR2TLKW90klIrYQAhHw"

    const options = {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' 
        }
    };

    try {
        console.log('Đang gửi 10 requests cùng lúc (Bỏ qua nếu có lỗi)...');

        const requests = Array.from({ length: 100 }, async (_, index) => {
            try {
                const response = await fetch(apiUrl, options);
                
                if (!response.ok) {
                    console.log(`[Request ${index + 1}] Thất bại - HTTP ${response.status}`);
                    return null;
                }
                
                const data = await response.json();
                console.log(`[Request ${index + 1}] Thành công!`);
                return data;

            } catch (error) {
                console.log(`[Request ${index + 1}] Lỗi kết nối: ${error.message}`);
                return null; 
            }
        });

        const results = await Promise.all(requests);

        const successfulData = results.filter(item => item !== null);

        console.log('---');
        console.log(`✅ Hoàn tất! Số lượng request thành công: ${successfulData.length}/10`);
        if (successfulData.length > 0) {
            console.log('Dữ liệu trả về:', successfulData);
        }

    } catch (error) {
        console.error('❌ Lỗi hệ thống:', error);
    }
}

fetchUserInfoMultipleTimes();