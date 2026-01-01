# Sewing Camp Management System 🧵

![Status](https://img.shields.io/badge/Status-Production--Ready_Prototype-blue)
![Protocol](https://img.shields.io/badge/Protocol-HTTP-yellow)
![AWS](https://img.shields.io/badge/AWS-Elastic_Beanstalk-orange)
![Database](https://img.shields.io/badge/PostgreSQL-RDS-blue)

**Live Demo:** [http://sewing.is404.net](http://sewing.is404.net)

> **⚠️ Note on Protocol:** This demonstration deployment uses **HTTP** to minimize AWS infrastructure costs (specifically Load Balancer fees). The application architecture is fully compatible with SSL/TLS and will be secured via HTTPS upon final commercial deployment.

## 📖 Project Status & Overview
This full-stack web application was built to modernize the registration process for a local youth sewing camp. It is currently deployed as a **live prototype**. While it is fully functional and ready for use, it is not yet processing real commercial transactions.

The system replaces manual spreadsheet tracking with a centralized cloud database, allowing:
* **Parents** to register children and sign waivers digitally.
* **Administrators** to manage class sizes, payments, and schedules.

## 🔐 Security & Access Control
**Admin Dashboard Access:**
This application is designed to handle sensitive Personally Identifiable Information (PII) such as children's names, medical details, and parent contact info.

To maintain strict data privacy standards for the business owner, **public access to the Administrative Dashboard is restricted.** I have effectively "locked the doors" to ensure no future private data is compromised.

### 🎥 Admin Workflow Demo
Since you cannot log in to the live admin panel, please view this recording of the administrative workflow. This demonstrates **Authentication**, **Database Retrieval**, and **Record Updates** in action:

![Admin Workflow Demo](/images/SilentDemoSewingMadeSimple.gif)

## ✨ Key Features
* **Public Registration Portal:** Dynamic forms allowing parents to register children, select specific camp sessions, and sign digital waivers.
* **Real-Time Seat Tracking:** Database logic prevents overbooking by tracking remaining seats in real-time.
* **Automated Email Notifications:** Integrated with `Nodemailer` to send immediate confirmation emails upon registration.
* **Cloud Architecture:** Deployed on **AWS Elastic Beanstalk** with a managed **PostgreSQL (RDS)** database.

## 🛠️ Tech Stack
* **Frontend:** EJS (Templating), CSS3, HTML5
* **Backend:** Node.js, Express.js
* **Database:** PostgreSQL (Hosted on AWS RDS), Knex.js (Query Builder)
* **DevOps:** AWS Elastic Beanstalk, EC2, Route 53
* **Security:** Session-based authentication, Environment variable protection

## 🚀 How to Run Locally
To run this project on your own machine (and access the admin panel locally):

1.  **Clone the repository**
    ```bash
    git clone [https://github.com/YOUR_USERNAME/sewing-camp-management-system.git](https://github.com/YOUR_USERNAME/sewing-camp-management-system.git)
    cd sewing-camp-management-system
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Configure Environment**
    Create a `.env` file in the root directory and add your credentials:
    ```text
    DB_HOST=localhost
    DB_USER=your_local_user
    DB_PASSWORD=your_local_password
    DB_NAME=sewing_db
    PORT=3000
    ```

4.  **Run the application**
    ```bash
    npm start
    ```
    Visit `http://localhost:3000` in your browser.
