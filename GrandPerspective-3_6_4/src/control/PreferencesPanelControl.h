/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Cocoa/Cocoa.h>


extern NSString  *FileDeletionTargetsKey;
extern NSString  *ConfirmFileDeletionKey;
extern NSString  *ConfirmFolderDeletionKey;
extern NSString  *DefaultRescanActionKey;
extern NSString  *RescanBehaviourKey;
extern NSString  *NoViewsBehaviourKey;
extern NSString  *FileSizeMeasureKey;
extern NSString  *FileSizeUnitSystemKey;
extern NSString  *DefaultDrawItemsKey;
extern NSString  *DefaultColorMappingKey;
extern NSString  *DefaultColorPaletteKey;
extern NSString  *DefaultDrawItemsKey;
extern NSString  *ScanFilterKey;
extern NSString  *MaskFilterKey;
extern NSString  *DefaultColorGradient;
extern NSString  *MinimumTimeBoundForColorMappingKey;
extern NSString  *ShowEntireVolumeByDefaultKey;
extern NSString  *ProgressPanelRefreshRateKey;
extern NSString  *ProgressPanelStableTimeKey;
extern NSString  *DefaultViewWindowWidth;
extern NSString  *DefaultViewWindowHeight;
extern NSString  *CustomFileOpenApplication;
extern NSString  *CustomFileRevealApplication;
extern NSString  *UpdateFiltersBeforeUse;
extern NSString  *DelayBeforeWelcomeWindowAfterStartupKey;
extern NSString  *KeyboardNavigationDeltaKey;
extern NSString  *PackageCheckBehaviorKey;
extern NSString  *DefaultDisplayFocusKey;

// Permission checks
extern NSString  *SuppressFdaWarningsKey;
extern NSString  *SuppressFdaSuccessKey;
extern NSString  *RootVolumeBookmarkKey;

extern NSString  *UnlimitedDisplayFocusValue;


@class FilterPopUpControl;

@interface PreferencesPanelControl : NSWindowController {

  IBOutlet NSPopUpButton  *fileDeletionPopUp;
  IBOutlet NSButton  *fileDeletionConfirmationCheckBox;
  
  IBOutlet NSPopUpButton  *rescanBehaviourPopUp;

  IBOutlet NSPopUpButton  *noViewsBehaviourPopUp;
  
  IBOutlet NSPopUpButton  *fileSizeMeasurePopUp;
  IBOutlet NSPopUpButton  *fileSizeUnitSystemPopUp;
  IBOutlet NSPopUpButton  *scanFilterPopUp;

  IBOutlet NSPopUpButton  *defaultDrawItemsPopUp;
  IBOutlet NSPopUpButton  *defaultColorMappingPopUp;
  IBOutlet NSPopUpButton  *defaultColorPalettePopUp;
  IBOutlet NSPopUpButton  *defaultMaskFilterPopUp;
  IBOutlet NSPopUpButton  *defaultDisplayFocusPopUp;

  IBOutlet NSButton  *showEntireVolumeByDefaultCheckBox;

  FilterPopUpControl  *defaultMaskFilterPopUpControl;
  FilterPopUpControl  *scanFilterPopUpControl;
}

- (IBAction) popUpValueChanged:(id)sender;

- (IBAction) valueChanged:(id)sender;

+ (BOOL) appHasDeletePermission;

@end
