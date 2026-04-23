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

#import "PreferencesPanelControl.h"

#import "DirectoryViewControl.h"
#import "MainMenuControl.h"
#import "FileItemMappingCollection.h"
#import "ColorListCollection.h"
#import "TreeBuilder.h"
#import "TreeDrawerBaseSettings.h"

#import "FilterRepository.h"
#import "FilterPopUpControl.h"

#import "UniqueTagsTransformer.h"

NSString  *FileDeletionTargetsKey = @"fileDeletionTargets";
NSString  *ConfirmFileDeletionKey = @"confirmFileDeletion";
NSString  *RescanBehaviourKey = @"rescanBehaviour";
NSString  *NoViewsBehaviourKey = @"noViewsBehaviour";
NSString  *FileSizeMeasureKey = @"fileSizeMeasure";
NSString  *FileSizeUnitSystemKey = @"fileSizeUnitSystem";
NSString  *ScanFilterKey = @"scanFilter";
NSString  *MaskFilterKey = @"maskFilter";
NSString  *DefaultDrawItemsKey = @"defaultDrawItems";
NSString  *DefaultColorMappingKey = @"defaultColorMapping";
NSString  *DefaultColorPaletteKey = @"defaultColorPalette";
NSString  *ShowEntireVolumeByDefaultKey = @"showEntireVolumeByDefault";
NSString  *DefaultDisplayFocusKey = @"defaultDisplayFocus";

// Deprecated since 3.5.3
NSString  *ShowPackageContentsByDefaultKey_Deprecated = @"showPackageContentsByDefault";

// Deprecated since 3.1.0
NSString  *DefaultFilterKey_Deprecated = @"defaultFilter";

// Can be set from the FDA warning sheets and panels
NSString  *SuppressFdaWarningsKey = @"suppressFdaWarnings";

/* Note: The preferences below cannot currently be changed from the preferences panel; they are set
 * by the application defaults and can be changed by manually editing the user preferences file.
 */
NSString  *DefaultRescanActionKey = @"defaultRescanAction";
NSString  *ConfirmFolderDeletionKey = @"confirmFolderDeletion";
NSString  *DefaultColorGradient = @"defaultColorGradient";
NSString  *MinimumTimeBoundForColorMappingKey = @"minimumTimeBoundForColorMapping";
NSString  *ProgressPanelRefreshRateKey = @"progressPanelRefreshRate";
NSString  *ProgressPanelStableTimeKey = @"progressPanelStableTime";
NSString  *DefaultViewWindowWidth = @"defaultViewWindowWidth";
NSString  *DefaultViewWindowHeight = @"defaultViewWindowHeight";
NSString  *CustomFileOpenApplication = @"customFileOpenApplication";
NSString  *CustomFileRevealApplication = @"customFileRevealApplication";
NSString  *UpdateFiltersBeforeUse = @"updateFiltersBeforeUse";
NSString  *DelayBeforeWelcomeWindowAfterStartupKey = @"delayBeforeWelcomeWindowAfterStartup";
NSString  *KeyboardNavigationDeltaKey = @"keyboardNavigationDelta";
NSString  *PackageCheckBehaviorKey = @"packageCheckBehavior";

NSString  *RootVolumeBookmarkKey = @"rootVolumeBookmark";
NSString  *SuppressFdaSuccessKey = @"suppressFdaSuccess";

NSString  *UnlimitedDisplayFocusValue = @"unlimited";

@interface PreferencesPanelControl (PrivateMethods)

+ (BOOL) doesAppHaveFileDeletePermission;

- (void) setupPopUp:(NSPopUpButton *)popUp key:(NSString *)key content:(NSArray *)names;

// This pop-up has its own setup method, as not all values need to be localized.
- (void) setupDefaultDisplayFocusPopUp;

- (void) setPopUp:(NSPopUpButton *)popUp toValue:(NSString *)value;

- (void) updateButtonState;

@end

@implementation PreferencesPanelControl

static BOOL appHasDeletePermission;

// Thread-safe initialisation
+ (void)initialize {
  // TODO: Re-enable once this works again.
  appHasDeletePermission = YES; // [PreferencesPanelControl doesAppHaveFileDeletePermission];
}

+ (BOOL) appHasDeletePermission {
  return appHasDeletePermission;
}

- (instancetype) init {
  if (self = [super initWithWindow: nil]) {
    // Trigger loading of the window
    [self window];
  }

  return self;
}

- (void) dealloc {
  [defaultMaskFilterPopUpControl release];
  [scanFilterPopUpControl release];
  
  [super dealloc];
}


- (NSString *)windowNibName {
  return @"PreferencesPanel";
}

- (void) windowDidLoad {
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;

  // Configure all pop-up buttons.
  [self setupPopUp: fileDeletionPopUp
               key: FileDeletionTargetsKey
           content: DirectoryViewControl.fileDeletionTargetNames];
  [self setupPopUp: rescanBehaviourPopUp
               key: RescanBehaviourKey
           content: MainMenuControl.rescanBehaviourNames];
  [self setupPopUp: noViewsBehaviourPopUp
               key: NoViewsBehaviourKey
           content: MainMenuControl.noViewsBehaviourNames];
  [self setupPopUp: fileSizeMeasurePopUp
               key: FileSizeMeasureKey
           content: TreeBuilder.fileSizeMeasureNames];
  [self setupPopUp: fileSizeUnitSystemPopUp
               key: FileSizeUnitSystemKey
           content: FileItem.fileSizeUnitSystemNames];
  [self setupPopUp: defaultDrawItemsPopUp
               key: DefaultDrawItemsKey
           content: TreeDrawerBaseSettings.drawItemsNames];
  [self setupPopUp: defaultColorMappingPopUp
               key: DefaultColorMappingKey
           content: FileItemMappingCollection.defaultFileItemMappingCollection.allKeys];
  [self setupPopUp: defaultColorPalettePopUp
               key: DefaultColorPaletteKey
           content: ColorListCollection.defaultColorListCollection.allKeys];

  [self setupDefaultDisplayFocusPopUp];

  if (! appHasDeletePermission) {
    // Cannot delete, so fix visible setting to "DeleteNothing" and prevent changes
    [fileDeletionPopUp setEnabled: false];
    [self setPopUp: fileDeletionPopUp toValue: DeleteNothing];
  }

  // Convert old deprecated settings
  NSString  *oldStringSetting = [userDefaults stringForKey: DefaultFilterKey_Deprecated];
  if (oldStringSetting != nil) {
    NSLog(@"Read default mask from %@", DefaultFilterKey_Deprecated);
    [userDefaults setObject: oldStringSetting forKey: MaskFilterKey];
    [userDefaults removeObjectForKey: DefaultFilterKey_Deprecated];
  }
  NSObject  *oldSetting = [userDefaults objectForKey: ShowPackageContentsByDefaultKey_Deprecated];
  if (oldSetting != nil) {
    NSLog(@"Read old view setting from %@", ShowPackageContentsByDefaultKey_Deprecated);
    BOOL  showPackageContents = ((NSNumber *)oldSetting).boolValue;
    DrawItemsEnum  newSetting = showPackageContents ? DRAW_FILES : DRAW_PACKAGES;

    [userDefaults setObject: [TreeDrawerBaseSettings nameForDrawItemsEnum: newSetting]
                     forKey: DefaultDrawItemsKey];
    [userDefaults removeObjectForKey: ShowPackageContentsByDefaultKey_Deprecated];
  }

  UniqueTagsTransformer  *tagMaker = UniqueTagsTransformer.defaultUniqueTagsTransformer;

  // The filter pop-ups use their own control that keep it up to date. Their entries change when
  // filters are added/removed.
  defaultMaskFilterPopUpControl =
    [[FilterPopUpControl alloc] initWithPopUpButton: defaultMaskFilterPopUp];
  [defaultMaskFilterPopUpControl selectFilterNamed: [userDefaults stringForKey: MaskFilterKey]];
  defaultMaskFilterPopUp.tag = [[tagMaker transformedValue: MaskFilterKey] intValue];

  scanFilterPopUpControl =
    [[FilterPopUpControl alloc] initWithPopUpButton: scanFilterPopUp
                                   filterRepository: FilterRepository.defaultFilterRepository
                                         noneOption: YES];
  [scanFilterPopUpControl selectFilterNamed: [userDefaults stringForKey: ScanFilterKey]];
  scanFilterPopUp.tag = [[tagMaker transformedValue: ScanFilterKey] intValue];

  fileDeletionConfirmationCheckBox.state =
    [userDefaults boolForKey: ConfirmFileDeletionKey]
    ? NSControlStateValueOn : NSControlStateValueOff;
  showEntireVolumeByDefaultCheckBox.state =
    [userDefaults boolForKey: ShowEntireVolumeByDefaultKey]
    ? NSControlStateValueOn : NSControlStateValueOff;

  [self updateButtonState];
  
  [self.window center];
}


- (IBAction) popUpValueChanged:(id)sender {
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  UniqueTagsTransformer  *tagMaker = UniqueTagsTransformer.defaultUniqueTagsTransformer;

  NSPopUpButton  *popUp = sender;
  NSObject  *value = [tagMaker valueForTag: popUp.selectedItem.tag];
  NSString  *key = [tagMaker nameForTag: popUp.tag];

  [userDefaults setObject: value forKey: key];
  
  if (popUp == fileDeletionPopUp) {
    [self updateButtonState];
  }
}

- (IBAction) valueChanged:(id)sender {
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;

  if (sender == fileDeletionConfirmationCheckBox) {
    BOOL  enabled = [sender state] == NSControlStateValueOn;

    [userDefaults setBool: enabled forKey: ConfirmFileDeletionKey];
  }
  else if (sender == showEntireVolumeByDefaultCheckBox) {
    BOOL  enabled = [sender state] == NSControlStateValueOn;
    
    [userDefaults setBool: enabled forKey: ShowEntireVolumeByDefaultKey];
  }
  else {
    NSAssert(NO, @"Unexpected sender for -valueChanged.");
  }
}

@end // @implementation PreferencesPanelControl


@implementation PreferencesPanelControl (PrivateMethods)

- (void) setupPopUp:(NSPopUpButton *)popUp
                key:(NSString *)key
            content:(NSArray *)names {
  UniqueTagsTransformer  *tagMaker = UniqueTagsTransformer.defaultUniqueTagsTransformer;
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  
  // Associate the pop-up with its key in the preferences by their tag.
  popUp.tag = [[tagMaker transformedValue: key] intValue];

  // Initialise the pop-up with its (localized) content
  [popUp removeAllItems];
  [tagMaker addLocalisedNamesFor: names
                         toPopUp: popUp
                          select: [userDefaults stringForKey: key]
                           table: @"Names"];
}

- (void) setupDefaultDisplayFocusPopUp {
  UniqueTagsTransformer  *tagMaker = UniqueTagsTransformer.defaultUniqueTagsTransformer;
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  NSPopUpButton  *popUp = defaultDisplayFocusPopUp;
  NSString  *prefValue = [userDefaults stringForKey: DefaultDisplayFocusKey];

  popUp.tag = [[tagMaker transformedValue: DefaultDisplayFocusKey] intValue];
  [popUp removeAllItems];

  int index = 0;

  // Note: The range of preference defaults is more limited than the values that the setting can
  // take. A value of one is simply useless (this value only helps to temporarily show the mechanics
  // of changing the focus). High values are also not that useful, as their impact is typically
  // small. Only in certain scenarios can it make sense.
  for (int i = MAX(2, MIN_DISPLAY_DEPTH_LIMIT); i <= MIN(5, MAX_DISPLAY_DEPTH_LIMIT); ++i) {
    NSNumber  *numberVal = @(i);
    NSString  *title = numberVal.stringValue;
    [tagMaker addValue: numberVal
             withTitle: title
               toPopUp: popUp
               atIndex: index++
                select: [title isEqualToString: prefValue]];
  }

  NSString  *title = [NSBundle.mainBundle localizedStringForKey: UnlimitedDisplayFocusValue
                                                          value: nil
                                                          table: @"Names"];

  [tagMaker addValue: UnlimitedDisplayFocusValue
           withTitle: title
             toPopUp: popUp
             atIndex: index
              select: [UnlimitedDisplayFocusValue isEqualToString: prefValue]];
}

- (void) setPopUp: (NSPopUpButton *)popUp toValue:(NSString *)value {
  UniqueTagsTransformer  *tagMaker = UniqueTagsTransformer.defaultUniqueTagsTransformer;

  NSUInteger  tag = [tagMaker tagForName: value];
  [popUp selectItemAtIndex: [popUp indexOfItemWithTag: tag]];
}

- (void) updateButtonState {
  UniqueTagsTransformer  *tagMaker = UniqueTagsTransformer.defaultUniqueTagsTransformer;
  NSString  *name = [tagMaker nameForTag: fileDeletionPopUp.selectedItem.tag];

  fileDeletionConfirmationCheckBox.enabled = ![name isEqualToString: DeleteNothing];
}

/* Check if the application has permission to delete files. The assumption is that the application
 * has this permission unless it is established that it is sandboxed and that it lacks the needed
 * read-write permissions for files selected by the user.
 */
+ (BOOL) doesAppHaveFileDeletePermission {
  // By default assume the app has delete permission. In that case, when there is a failure
  // establishing the correct permission, the worst that can happen is that delete fails (which
  // may happen anyway, e.g. when a file has read-only settings). The alternative is that the app
  // would unnecessarily prevent the user from deleting files, after the user has indicated he
  // want to be able to do this.
  BOOL  canDelete = true;
  OSStatus  err;
  SecCodeRef  me;
  CFDictionaryRef  dynamicInfo;

  NSLog(@"Trying to establish application entitlements");

  // On Mojave this invocation results in the following log messages:
  //  [logging-persist] cannot open file at line 42249 of [95fbac39ba]
  //  [logging-persist] os_unix.c:42249: (0) open(/var/db/DetachedSignatures) - Undefined error: 0
  // Hopefully this will be fixed/resolved in a future version of macOS.
  err = SecCodeCopySelf(kSecCSDefaultFlags, &me);

  if (err != errSecSuccess) {
    NSLog(@"Failed to successfully invoke SecCodeCopySelf -> %d", err);
    return canDelete;
  }

  // On Catalina the invocation below results in a crash.
  err = SecCodeCopySigningInformation(me, (SecCSFlags) kSecCSDynamicInformation, &dynamicInfo);
  if (err != errSecSuccess) {
    NSLog(@"Failed to successfully invoke SecCodeCopySigningInformation -> %d", err);
  }
  else {
    NSDictionary  *entitlements = CFDictionaryGetValue(dynamicInfo, kSecCodeInfoEntitlementsDict);
    NSLog(@"entitlements = %@", entitlements);

    canDelete = (
      !entitlements[@"com.apple.security.app-sandbox"] ||
      entitlements[@"com.apple.security.files.user-selected.read-write"]
    );
  }

  CFRelease(dynamicInfo);
  NSLog(@"doesAppHaveFileDeletePermission = %d", canDelete);
  return canDelete;
}

@end // @implementation PreferencesPanelControl (PrivateMethods)
