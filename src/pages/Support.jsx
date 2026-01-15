import { useState } from "react";
import Layout from "../layout/Layout";
import { useNavigate } from "react-router-dom";
// import { getOnuHwDets, registerCustomer } from "../services/registrationApis";
import { Button, Badge, Input, FloatingInput } from "@/components/ui";
import { AppWindow, Globe, Headset, Tv, PhoneCall, Mail, Smartphone, IndianRupee, Info, ArrowRight } from "lucide-react";
import { WhatsappIcon } from "../components/icons/Whatsappicon";
import useOpenWhatsApp from "../hooks/useOpenWhatsApp";

export default function Support() {
  const navigate = useNavigate();
  const Callto = ({ phone, children }) => {
    return <a href={`tel:${phone}`}>{children}</a>;
 }

 const openWhatsApp = ({phone, msg}) => {
    // useOpenWhatsApp(phone, msg, { preferWebOnDesktop: true })
    // navigate("https://wa.me/"+phone+"?text="+encodeURIComponent(msg));
    // var waMe = "https://wa.me/"+phone+"?text="+encodeURIComponent(msg);
    // window.open(waMe, "_blank", "noopener,noreferrer");
};

 function EmailButton() {
  const recipient = 'supporteam@bbnl.co.in';
  const subject = 'Internet Support Request';
  const body = 'Hello, I would like to contact you regarding internet support. Please assist me with my issue.';

  const handleSendEmail = () => {
    window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <button onClick={handleSendEmail}>
        <Mail className="text-grey-500" /> 
    </button>
  );
}
    
  return (
    <Layout>
        <div className="bg-white dark:bg-gray-900 shadow-xl rounded-2xl p-4 max-w-lg w-full text-center animate-fade-in text-sm">
        <div className="flex justify-center mb-2">
          <Headset className="h-12 w-12 text-blue-500 animate-bounce" />
        </div>

        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">
          24/7 Support
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-2">
          Enjoy uninterrupted Internet, IPTV, and VoIP services with 24/7 support from our expert team.
        </p>

        <div className="bg-blue-50 dark:bg-gray-800 rounded-xl p-4 mb-2 text-left space-y-2">
          <div className="flex items-center space-x-2">
            {/* <Smartphone className="text-blue-500" /> */}
            <Globe className="text-blue-500" />
            <p className="font-semibold text-blue-700 dark:text-blue-300">
              Internet & VoIP
            </p>
          </div>
          <p className="text-gray-700 dark:text-gray-400 pl-6">
            <div className="flex items-center gap-2 mb-1">
                <PhoneCall className="text-grey-500" /> 
                <Callto phone="080-67995700">080-67995700</Callto>
            </div>
            {/* <div className="flex items-center gap-2 mb-1">
                <Smartphone className="text-grey-500" /> 
                <Callto phone="+91 90080 09570">+91 90080 09570</Callto>
            </div> */}
            <div className="flex items-center gap-2 mb-1">
                <EmailButton />
                supporteam@bbnl.co.in
            </div>
          </p>
        </div>

        <div className="bg-blue-50 dark:bg-gray-800 rounded-xl p-4 mb-2 text-left space-y-2">
          <div className="flex items-center space-x-2">
            <Tv className="w-6 h-8 text-blue-600" />
            <p className="font-semibold text-blue-700 dark:text-blue-300">
              IPTV
            </p>
          </div>
          <p className="text-gray-700 dark:text-gray-400 pl-6">
            <div className="flex items-center gap-2 mb-1">
              <PhoneCall className="text-grey-500" />
              <Callto phone="080-67995799">080-67995799</Callto>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <Smartphone className="text-grey-500" />
              <Callto phone="+91 90080 09570">+918095596945</Callto>/<Callto phone="+91 90080 09570">+918095596496</Callto>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <WhatsappIcon size={22} className="text-grey-400" /><span onClick={() => openWhatsApp('918095596945', 'Hi')}>+918095596945</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <Mail className="text-grey-500" /> supporteam@fofilabs.com
            </div>
          </p>
        </div>

        <div className="bg-blue-50 dark:bg-gray-800 rounded-xl p-4 mb-2 text-left space-y-2">
          <div className="flex items-center space-x-2">
            <AppWindow className="w-6 h-8 text-blue-600" />
            <p className="font-semibold text-blue-700 dark:text-blue-300">
              Netmon & CRM
            </p>
          </div>
          <p className="text-gray-700 dark:text-gray-400 pl-6">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone className="text-grey-500" /> 
              <Callto phone="+91 99457 62186">+91 99457 62186</Callto>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <Mail className="text-grey-500" /> supportteam@fofilabs.com
            </div>
          </p>
        </div>

        <div className="bg-blue-50 dark:bg-gray-800 rounded-xl p-4 mb-2 text-left space-y-2">
          <div className="flex items-center space-x-2">
            <IndianRupee className="w-6 h-8 text-blue-600" />
            <p className="font-semibold text-blue-700 dark:text-blue-300">
              Billing & Collection
            </p>
          </div>
          <p className="text-gray-700 dark:text-gray-400 pl-6">
            <div className="flex items-center gap-2 mb-1">
                <Smartphone className="text-grey-500" />
                <Callto phone="+91 80955 96101">+91 80955 96101</Callto>
            </div>
            <div className="flex items-center gap-2 mb-1">
                <Mail className="text-grey-500" /> accountsteam@bbnl.co.in
            </div>
          </p>
        </div>

        {/* <div className="flex items-center justify-center text-blue-600 dark:text-blue-400 font-medium gap-1">
          <span>Continue using browser</span>
          <ArrowRight className="w-4 h-4" />
        </div> */}
      </div>
      {/* <div className="max-w-2xl mx-auto space-y-2 px-3 py-2">
        <div className="space-y-3">
            <div className="items-center justify-between bg-white p-3 rounded-xl shadow">
                <h2 className="text-md font-semibold dark:text-gray-700 mb-2">Plan Details</h2>
                <div className="flex flex-col gap-2 text-sm">
                    
                    <div className="flex">
                        <span className="w-28 font-medium text-gray-700 dark:text-gray-600">Service Type</span>
                        <span className="text-gray-500 dark:text-gray-600">Internet</span>
                    </div>

                    <div className="flex">
                        <span className="w-28 font-medium text-gray-700 dark:text-gray-600">Plan Name</span>
                        <span className="text-gray-500 dark:text-gray-600">{ selectedPlan.serv_name }</span>
                    </div>

                    <div className="flex gap-4">
                        <Badge color="indigo">{ selectedPlan.serv_rates?.labels[0] }</Badge>
                        <Badge color="purple" size="sm"> {import.meta.env.VITE_API_APP_DEFAULT_CURRENCY_SYMBOL +' '+ selectedPlan.serv_rates?.prices[0] }</Badge>
                    </div>
                </div>
            </div> 
        </div>
      </div>*/}
    </Layout>
  );
}
